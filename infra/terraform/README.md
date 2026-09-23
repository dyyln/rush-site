# Terraform (not used yet)

Nothing here is applied today. Launch runs on one Hetzner AX dedicated box, which Terraform cannot order.

`hcloud/` is a minimal module for the later milestone: a CCX cloud server for peak CS2 load plus its firewall. Its agent is reached over a private network only.

When it is needed:

```bash
cd infra/terraform/hcloud
export TF_VAR_hcloud_token=...   # never commit it
terraform init
terraform plan -var 'ssh_key_names=["dylan"]' -var 'api_source_ips=["10.0.0.2/32"]'
```

State should move to a remote backend before real use.
