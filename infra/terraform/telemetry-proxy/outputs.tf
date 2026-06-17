output "ingest_url" {
  description = "Public ingest endpoint for virage telemetry"
  value       = "https://telemetry.virage.vivantel.dev/ingest"
}

output "worker_name" {
  description = "Cloudflare Worker script name"
  value       = cloudflare_workers_script.proxy.name
}
