//go:build !linux

package hostmetrics

// New returns nil off Linux so health reports no metrics.
func New(diskPath string) *Sampler { return nil }
