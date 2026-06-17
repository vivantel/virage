terraform {
  required_version = ">= 1.10"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4"
    }
  }

  backend "s3" {
    key          = "virage/telemetry-proxy/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
    # bucket and region supplied via -backend-config at init time
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
