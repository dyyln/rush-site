//go:build linux

package hostmetrics

import "syscall"

// New returns a sampler over /proc that reports disk use for diskPath.
func New(diskPath string) *Sampler {
	s := &Sampler{Root: "/proc", DiskPath: diskPath, Statfs: statfs}
	s.Prime()
	return s
}

func statfs(path string) (total, free uint64, err error) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return 0, 0, err
	}
	bs := uint64(st.Bsize)
	return st.Blocks * bs, st.Bfree * bs, nil
}
