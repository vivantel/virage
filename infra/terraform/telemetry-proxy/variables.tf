variable "cloudflare_api_token" {
  description = "Cloudflare API token with Workers:Edit and DNS:Edit permissions"
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for vivantel.dev"
  type        = string
}

variable "honeycomb_api_key" {
  description = "Honeycomb ingest API key (X-Honeycomb-Team)"
  type        = string
  sensitive   = true
}

variable "honeycomb_dataset" {
  description = "Honeycomb dataset name"
  type        = string
  default     = "virage-community"
}
