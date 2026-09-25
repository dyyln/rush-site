// Hosting prices for the admin cost estimates. Recheck before relying on them, see docs/REVIEW-BIZ.md section 5
export const HOSTING_COSTS = {
  // DatHost per running server hour. Per minute billing is assumed
  dathostEurPerHour: 0.33,
  // One Hetzner AX102 box, spread evenly over the days it is online
  hetznerBoxEurPerMonth: 122.3,
} as const

export type HostingCosts = { dathostEurPerHour: number; hetznerBoxEurPerMonth: number }
