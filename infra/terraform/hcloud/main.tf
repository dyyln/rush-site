# Not used yet. CCX cloud server for peak CS2 capacity.

resource "hcloud_firewall" "cs2" {
  name = "${var.name}-fw"

  rule {
    description = "ssh"
    direction   = "in"
    protocol    = "tcp"
    port        = "22"
    source_ips  = var.admin_ssh_cidrs
  }

  rule {
    description = "cs2 game traffic"
    direction   = "in"
    protocol    = "udp"
    port        = var.game_port_range
    source_ips  = ["0.0.0.0/0", "::/0"]
  }

  rule {
    description = "host agent, api only"
    direction   = "in"
    protocol    = "tcp"
    port        = "8080"
    source_ips  = var.api_source_ips
  }

  rule {
    direction  = "in"
    protocol   = "icmp"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
}

resource "hcloud_server" "cs2" {
  name         = var.name
  server_type  = var.server_type
  location     = var.location
  image        = var.image
  ssh_keys     = var.ssh_key_names
  firewall_ids = [hcloud_firewall.cs2.id]

  labels = {
    app  = "rushsite"
    role = "cs2-host"
  }

  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }

  dynamic "network" {
    for_each = var.network_id == null ? [] : [var.network_id]
    content {
      network_id = network.value
    }
  }
}
