locals {
  worker_name    = "virage-telemetry-proxy"
  worker_bundle  = "${path.module}/../../../services/telemetry-proxy/dist/index.js"
  subdomain      = "telemetry.virage"
  ingest_pattern = "${local.subdomain}.vivantel.dev/ingest"
}

resource "cloudflare_workers_script" "proxy" {
  account_id = var.cloudflare_account_id
  name       = local.worker_name
  content    = file(local.worker_bundle)

  plain_text_binding {
    name = "HONEYCOMB_DATASET"
    text = var.honeycomb_dataset
  }

  secret_text_binding {
    name = "HONEYCOMB_API_KEY"
    text = var.honeycomb_api_key
  }
}

resource "cloudflare_worker_route" "proxy" {
  zone_id     = var.cloudflare_zone_id
  pattern     = local.ingest_pattern
  script_name = cloudflare_workers_script.proxy.name
}

resource "cloudflare_record" "telemetry_virage" {
  zone_id = var.cloudflare_zone_id
  name    = local.subdomain
  type    = "AAAA"
  value   = "100::"
  proxied = true
  comment = "Cloudflare Workers anycast — routes to virage-telemetry-proxy"
}
