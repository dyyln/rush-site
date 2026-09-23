output "ipv4" {
  value = hcloud_server.cs2.ipv4_address
}

output "private_ip" {
  value = try(one(hcloud_server.cs2.network[*].ip), null)
}

output "agent_url" {
  description = "Add to AGENT_URLS on the API host."
  value       = "http://${try(one(hcloud_server.cs2.network[*].ip), hcloud_server.cs2.ipv4_address)}:8080"
}
