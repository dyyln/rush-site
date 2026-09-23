variable "hcloud_token" {
  description = "Hetzner Cloud API token. Pass via TF_VAR_hcloud_token."
  type        = string
  sensitive   = true
}

variable "name" {
  description = "Server name."
  type        = string
  default     = "rushsite-ccx-1"
}

variable "server_type" {
  description = "Dedicated vCPU type for CS2."
  type        = string
  default     = "ccx33"
}

variable "location" {
  type    = string
  default = "fsn1"
}

variable "image" {
  type    = string
  default = "ubuntu-24.04"
}

variable "ssh_key_names" {
  description = "Names of SSH keys already uploaded to the Hetzner Cloud project."
  type        = list(string)
}

variable "admin_ssh_cidrs" {
  description = "CIDRs allowed to SSH in."
  type        = list(string)
  default     = ["0.0.0.0/0", "::/0"]
}

variable "api_source_ips" {
  description = "Private IPs of the API host that may call the agent on 8080."
  type        = list(string)
}

variable "game_port_range" {
  type    = string
  default = "27015-27030"
}

variable "network_id" {
  description = "Existing hcloud network to attach. Null skips it."
  type        = number
  default     = null
}
