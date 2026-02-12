name = "surewhynot-fax-worker"
main = "src/worker.js"
compatibility_date = "2024-01-01"

routes = ["surewhynot.app/api/*"]

[vars]
PUBLIC_BASE_URL = "https://surewhynot.app"
FAX_PAGE_PATH = "/pages/fax-v2.html"
MAIL_FROM = "fax@surewhynot.app"
VERIFY_TTL_SECONDS = "1800"
SINCH_PROJECT_ID = "d6bafa4e-727e-4888-a45b-de191a045890"
FREE_PAGES_PER_DAY = "5"
PRICE_PER_PAGE_CENTS = "10"

[[kv_namespaces]]
binding = "FAX_KV"
id = "4c73f1f7b8ff495e99a248bb06f3532c"

[[r2_buckets]]
binding = "FAX_R2"
bucket_name = "surewhynot-fax"

[[durable_objects.bindings]]
name = "USAGE_DO"
class_name = "UsageDO"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["UsageDO"]
