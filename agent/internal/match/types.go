// Package match holds the request types from docs/CONTRACTS.md, mode settings, validation and cfg rendering.
package match

// Mode is one of the three platform modes.
type Mode string

const (
	Aim1v1  Mode = "aim1v1"
	Aim2v2  Mode = "aim2v2"
	Rush3v3 Mode = "rush3v3"
)

// MapEntry mirrors the shared MapEntry type.
type MapEntry struct {
	ID          string   `json:"id"`
	DisplayName string   `json:"displayName"`
	WorkshopID  string   `json:"workshopId,omitempty"`
	MapName     string   `json:"mapName,omitempty"`
	Loadout     *Loadout `json:"loadout,omitempty"`
}

// WeaponPair is one loadout slot per side. Empty means the plugin default.
type WeaponPair struct {
	CT string `json:"ct,omitempty"`
	T  string `json:"t,omitempty"`
}

// Loadout overrides the plugin's default aim loadout for a map.
type Loadout struct {
	Primary   *WeaponPair `json:"primary,omitempty"`
	Secondary *WeaponPair `json:"secondary,omitempty"`
	Armor     string      `json:"armor,omitempty"`
}

// Team is one side of a match.
type Team struct {
	Name     string   `json:"name"`
	SteamIDs []string `json:"steamIds"`
	// Shown in game when set, such as a cup team name.
	DisplayName string `json:"displayName,omitempty"`
}

// Label is the in-game team name.
func (t Team) Label() string {
	if t.DisplayName != "" {
		return t.DisplayName
	}
	return t.Name
}

// DemoUpload says where the plugin puts the demo.
type DemoUpload struct {
	Bucket          string `json:"bucket"`
	Key             string `json:"key"`
	PresignedPutURL string `json:"presignedPutUrl"`
}

// Series is a best-of series played on one server. The plugin loads each map in turn.
type Series struct {
	BestOf         int            `json:"bestOf"`
	Maps           []MapEntry     `json:"maps"`
	StartMapNumber int            `json:"startMapNumber"`
	Wins           map[string]int `json:"wins"`
	DemoUploads    []DemoUpload   `json:"demoUploads"`
}

// StartRequest is the POST /servers body.
type StartRequest struct {
	MatchID         string     `json:"matchId"`
	Mode            Mode       `json:"mode"`
	Map             MapEntry   `json:"map"`
	GSLT            string     `json:"gslt"`
	Password        string     `json:"password"`
	AllowedSteamIDs []string   `json:"allowedSteamIds"`
	Teams           []Team     `json:"teams"`
	WebhookURL      string     `json:"webhookUrl"`
	WebhookSecret   string     `json:"webhookSecret"`
	DemoUpload      DemoUpload `json:"demoUpload"`
	// CS2 is the launch block built from shared config. It is required.
	CS2 *CS2Settings `json:"cs2"`
	// Series is set for best-of series. Map and CS2 then describe the first map to load.
	Series *Series `json:"series,omitempty"`
}

// CS2Settings is the cs2 block of StartRequest. It mirrors the shared Cs2Start type.
type CS2Settings struct {
	GameType   *int     `json:"gameType"`
	GameMode   *int     `json:"gameMode"`
	ExecCfg    string   `json:"execCfg"`
	ExtraArgs  []string `json:"extraArgs,omitempty"`
	WorkshopID string   `json:"workshopId,omitempty"`
	MapName    string   `json:"mapName,omitempty"`
}

// StartResponse is the POST /servers reply.
type StartResponse struct {
	MatchID string `json:"matchId"`
	IP      string `json:"ip"`
	Port    int    `json:"port"`
	Connect string `json:"connect"`
}

// PluginConfig is match.json, read by the CounterStrikeSharp plugin.
type PluginConfig struct {
	MatchID         string     `json:"matchId"`
	Mode            Mode       `json:"mode"`
	Map             MapEntry   `json:"map"`
	AllowedSteamIDs []string   `json:"allowedSteamIds"`
	Teams           []Team     `json:"teams"`
	Password        string     `json:"password"`
	WebhookURL      string     `json:"webhookUrl"`
	WebhookSecret   string     `json:"webhookSecret"`
	DemoUpload      DemoUpload `json:"demoUpload"`
	WinCondition    string     `json:"winCondition"`
	Series          *Series    `json:"series,omitempty"`
}
