terraform {
  required_version = ">= 1.5"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4"
    }
  }

  backend "s3" {
    bucket         = "vivantel-terraform-state"
    key            = "virage/telemetry-proxy/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "vivantel-terraform-locks"
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
