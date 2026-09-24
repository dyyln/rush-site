package update

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/rushsite/agent/internal/procrun"
)

// SteamInfPath is where the installed patch version lives.
func SteamInfPath(cs2Dir string) string {
	return filepath.Join(cs2Dir, "game", "csgo", "steam.inf")
}

// AppManifestPath is SteamCMD's manifest for app 730.
func AppManifestPath(cs2Dir string) string {
	return filepath.Join(cs2Dir, "steamapps", "appmanifest_730.acf")
}

// GameinfoPath is the file Metamod needs a search path line in.
func GameinfoPath(cs2Dir string) string {
	return filepath.Join(cs2Dir, "game", "csgo", "gameinfo.gi")
}

// ReadSteamInf returns key=value pairs from steam.inf.
func ReadSteamInf(path string) (map[string]string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	out := map[string]string{}
	sc := bufio.NewScanner(bytes.NewReader(b))
	for sc.Scan() {
		k, v, ok := strings.Cut(strings.TrimSpace(sc.Text()), "=")
		if ok {
			out[strings.TrimSpace(k)] = strings.TrimSpace(v)
		}
	}
	return out, sc.Err()
}

var reBuildID = regexp.MustCompile(`"buildid"\s+"(\d+)"`)

// InstalledBuildID reads the build id from appmanifest_730.acf.
func InstalledBuildID(cs2Dir string) (string, error) {
	b, err := os.ReadFile(AppManifestPath(cs2Dir))
	if err != nil {
		return "", err
	}
	m := reBuildID.FindSubmatch(b)
	if m == nil {
		return "", errors.New("no buildid in appmanifest_730.acf")
	}
	return string(m[1]), nil
}

// InstalledVersion is a display string like "1.41.8.2 (build 2000914)". Empty if unknown.
func InstalledVersion(cs2Dir string) string {
	var parts []string
	if inf, err := ReadSteamInf(SteamInfPath(cs2Dir)); err == nil && inf["PatchVersion"] != "" {
		parts = append(parts, inf["PatchVersion"])
	}
	if id, err := InstalledBuildID(cs2Dir); err == nil {
		parts = append(parts, "(build "+id+")")
	}
	return strings.Join(parts, " ")
}

// SteamAPIChecker asks Steam's ISteamApps/UpToDateCheck whether the installed patch version is current.
type SteamAPIChecker struct {
	CS2Dir  string
	BaseURL string
}

// Outdated implements Checker.
func (c SteamAPIChecker) Outdated(ctx context.Context) (bool, error) {
	inf, err := ReadSteamInf(SteamInfPath(c.CS2Dir))
	if err != nil {
		return false, err
	}
	pv := inf["PatchVersion"]
	if pv == "" {
		return false, errors.New("steam.inf has no PatchVersion")
	}
	// The API takes the patch version with the dots removed, 1.41.8.2 becomes 14182.
	version := strings.ReplaceAll(pv, ".", "")
	u := strings.TrimRight(c.BaseURL, "/") + "/ISteamApps/UpToDateCheck/v1/?appid=730&version=" + url.QueryEscape(version)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return false, err
	}
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("UpToDateCheck returned %s", resp.Status)
	}
	var body struct {
		Response struct {
			Success         bool   `json:"success"`
			UpToDate        bool   `json:"up_to_date"`
			RequiredVersion int64  `json:"required_version"`
			Message         string `json:"message"`
		} `json:"response"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return false, fmt.Errorf("decode UpToDateCheck: %w", err)
	}
	if !body.Response.Success {
		return false, fmt.Errorf("UpToDateCheck failed: %s", body.Response.Message)
	}
	return !body.Response.UpToDate, nil
}

// SteamCMDChecker compares the installed build id with the public branch build id from steamcmd app_info_print.
type SteamCMDChecker struct {
	CS2Dir   string
	SteamCMD string
	Runner   procrun.Runner
}

// Outdated implements Checker.
func (c SteamCMDChecker) Outdated(ctx context.Context) (bool, error) {
	installed, err := InstalledBuildID(c.CS2Dir)
	if err != nil {
		return false, err
	}
	var out bytes.Buffer
	code, err := procrun.Run(c.Runner, procrun.Spec{
		Path:   c.SteamCMD,
		Args:   []string{"+login", "anonymous", "+app_info_update", "1", "+app_info_print", "730", "+quit"},
		Stdout: &out,
	})
	if err != nil {
		return false, err
	}
	if code != 0 {
		return false, fmt.Errorf("steamcmd app_info_print exited with code %d", code)
	}
	latest, err := PublicBuildID(out.String())
	if err != nil {
		return false, err
	}
	return latest != installed, nil
}

// PublicBuildID pulls branches.public.buildid out of app_info_print output.
func PublicBuildID(appInfo string) (string, error) {
	i := strings.Index(appInfo, `"branches"`)
	if i < 0 {
		return "", errors.New("no branches block in app_info_print output")
	}
	rest := appInfo[i:]
	j := strings.Index(rest, `"public"`)
	if j < 0 {
		return "", errors.New("no public branch in app_info_print output")
	}
	m := reBuildID.FindStringSubmatch(rest[j:])
	if m == nil {
		return "", errors.New("no public buildid in app_info_print output")
	}
	return m[1], nil
}

var (
	reLowViolence   = regexp.MustCompile(`(?m)^([ \t]*)Game_LowViolence[ \t]+csgo_lv[^\n]*\n`)
	reMetamodLine   = regexp.MustCompile(`(?m)^[ \t]*Game[ \t]+csgo/addons/metamod[^\n]*\n`)
	reRushRoomsLine = regexp.MustCompile(`(?m)^[ \t]*Game[ \t]+` + regexp.QuoteMeta(rushRoomsLine) + `[^\n]*\n`)
)

// EnsureGameinfo keeps our search paths in gameinfo.gi. CS2 updates overwrite the file, which
// silently unloads Metamod and every plugin, and our Rush script.
// The Metamod line always goes in. The rushsite_rooms.vpk line goes right after it when rushRooms
// is true and is taken out when false, because a search path to a missing or bad VPK stops the server.
func EnsureGameinfo(path string, rushRooms bool) (bool, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return false, err
	}
	s := string(b)
	patched := s
	if !strings.Contains(patched, "csgo/addons/metamod") {
		loc := reLowViolence.FindStringSubmatchIndex(patched)
		if loc == nil {
			return false, errors.New("Game_LowViolence csgo_lv line not found")
		}
		indent := patched[loc[2]:loc[3]]
		patched = patched[:loc[1]] + indent + "Game\tcsgo/addons/metamod\n" + patched[loc[1]:]
	}
	has := reRushRoomsLine.MatchString(patched)
	switch {
	case rushRooms && !has:
		// Both lines must sit above `Game csgo` to win over pak01.
		loc := reMetamodLine.FindStringIndex(patched)
		if loc == nil {
			return false, errors.New("Metamod line not found")
		}
		line := patched[loc[0]:loc[1]]
		indent := line[:len(line)-len(strings.TrimLeft(line, " \t"))]
		patched = patched[:loc[1]] + indent + "Game\t" + rushRoomsLine + "\n" + patched[loc[1]:]
	case !rushRooms && has:
		patched = reRushRoomsLine.ReplaceAllString(patched, "")
	}
	if patched == s {
		return false, nil
	}
	info, err := os.Stat(path)
	if err != nil {
		return false, err
	}
	if err := os.WriteFile(path, []byte(patched), info.Mode().Perm()); err != nil {
		return false, err
	}
	return true, nil
}
