# dawa4u services — the Blinkit-style stack

WordPress (dawa4u.in) stays the shop, the dashboards and the record of every order. This stack runs next to it
on a VPS and adds what the 10-minute apps use:

| Piece | What it does for dawa4u |
|---|---|
| **Kafka** (KRaft, no ZooKeeper) | The event stream. Every order step, every stock count and every rider GPS ping is an event on `orders`, `stock` or `rider.location`. Services read the stream; none of them call each other to find out what happened. |
| **Redis** | In-memory store. Stock holds run as one Lua script, so the last strip can only go to one order (the video's "mutex"). It also keeps rider positions and the delivery times it has learned. |
| **gateway** (Python, FastAPI) | The only public service (`api.dawa4u.in`). Checks every request: WordPress signs with HMAC-SHA256, browsers use short-lived tokens. |
| **stock-svc** | Holds medicines at the best pharmacy that has them all, at checkout. Unpaid orders let go after 30 min, cancelled orders give the strips back, and a delivered order's strips are counted as sold. A new stock count from a pharmacy only shows strips that aren't held for an order. |
| **eta-svc** | Learns delivery times per few streets (**S2 cells**, level 14), per bigger area and per PIN code: whole delivery, ride, and *handover* (the time from the rider being 100 m away to delivered: parking, the gate, the lift). It uses the rider's live GPS while they're on the way. Inside 100 m it shows **"Arriving soon"** instead of a countdown. Rain adds a buffer. |
| **forecast-svc** | Predicts next week's orders with **gradient boosting** (scikit-learn, Poisson). It uses day of week, rain, yesterday, last week and averages; next week's rain comes from the weather forecast. With too little history it falls back to a weighted average. |
| **Caddy** | HTTPS certificates for `api.dawa4u.in`, renewed automatically. |
| **Kubernetes** (`k8s/`) | The same stack for k3s, for when one server isn't enough: several gateways with autoscaling, Redis and Kafka as StatefulSets. |

If the VPS is down or slow (more than 0.8 s), WordPress does everything itself as before. No order is lost; events
that couldn't be sent are kept and sent with the next ones.

## Run it on one server (Docker Compose)

```bash
git clone -b stack https://github.com/jeetpatidar536-cpu/dawa4u.git dawa4u-stack && cd dawa4u-stack
cp .env.example .env        # put the shared secret from WordPress in D4U_SECRET
docker compose up -d --build
curl https://api.dawa4u.in/health
```

Point a DNS **A record** for `api.dawa4u.in` at the server first, so Caddy can get the certificate.
In WordPress: WooCommerce → dawa4u partners → Services. Enter `https://api.dawa4u.in` and the same secret, or
define `D4U_SVC_URL` and `D4U_SVC_SECRET` in `wp-config.php`. The page shows ✓ next to each service when it is connected.

Size: Kafka about 1 GB of RAM, Redis up to 512 MB, the four services about 1 GB together. Hostinger **KVM 2**
(2 vCPU, 8 GB) has room to spare. KVM 1 (4 GB) works but is tight.

## Kubernetes (k3s)

```bash
curl -sfL https://get.k3s.io | sh -
kubectl apply -f k8s/00-namespace.yaml
kubectl -n dawa4u create secret generic d4u-env --from-env-file=.env
kubectl apply -f k8s/
```

The image `ghcr.io/jeetpatidar536-cpu/dawa4u-services` is built and pushed by GitHub Actions on every push to the
`stack` branch, after the tests pass against both Redis Streams and a real Kafka broker. For HTTPS, install
cert-manager with a `letsencrypt` ClusterIssuer.

## API (gateway)

From the WordPress server: send headers `X-Dawa4u-Time` (unix time) and `X-Dawa4u-Signature: sha256=HMAC(secret, time + "." + body)`.

| Request | |
|---|---|
| `POST /v1/events` | `[{"topic":"orders","key":"123","event":{...}}]`, up to 100 events per request |
| `POST /v1/stock/hold` | `{"order":"123","pharmacies":[13,16],"items":{"d4u-p9":1},"paid":false}` → `{"pharmacy":16,"held":true}` |
| `POST /v1/stock/release` | `{"order":"123"}` |
| `GET /v1/stock/{pharmacy}` | free and held strips |
| `GET /v1/eta?pin=452001&lat=&lng=` | `{"minutes":24,"raining":false,"learned":true}` |
| `GET /v1/forecast?pins=452001,452002` | next 7 days per medicine |

From browsers (tokens are made by WordPress and expire):

| Request | |
|---|---|
| `POST /v1/rider/location` | `{"t":"rider.<id>.<exp>.<mac>","lat":..,"lng":..,"acc":..}`, at most one ping every 4 s |
| `GET /v1/track/{order}?t=track.<order>.<exp>.<mac>` | `{"status":"d4u-out","minutes":6,"soon":false,"distance_m":1180}` |

## Tests

```bash
pip install -r services/requirements.txt pytest
pytest -q tests/test_stack.py                                         # Redis Streams as the bus
TEST_BUS=kafka KAFKA_BROKERS=localhost:9092 pytest -q tests/test_stack.py   # with a Kafka broker running
```

The tests start Redis and all four services as separate processes and use only the gateway, the same way
WordPress does. They cover:

- 10 people paying for 4 strips at the same moment: exactly 4 orders get one.
- Cancel gives strips back, delivered doesn't, a new stock count keeps held strips out.
- An unpaid hold expires.
- Delivery times are learned per street.
- Live GPS gives "Arriving in N min", then "Arriving soon" inside 100 m.
- Bad signatures and expired tokens are refused.
- The gradient-boosting model trains and predicts.

## What's not copied from Blinkit, and why

- **Java and Go services:** one language (Python) is easier for a small team to run. The services are split the
  same way, so any one of them can be rewritten in Go later without touching the rest.
- **Surge pricing on medicines:** not done. Rain only lengthens the delivery time customers see.
- **Dark stores and a mother warehouse:** dawa4u's partner pharmacies are the stores. The forecast and restock
  screens play the warehouse's part.
