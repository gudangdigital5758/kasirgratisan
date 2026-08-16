# Infrastructure Architecture

Target production shape:

```text
Internet → Cloudflare → Profitku
                    └→ MSC VPS
                       ├── API
                       ├── Workers
                       └── Redis
```

Database/storage topology must be verified from actual deployment before implementation.
