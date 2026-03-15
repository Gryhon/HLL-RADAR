# HLL-RADAR

Real-time player tracking and match replay for Hell Let Loose servers. Useful for analyzing matches and/or monitoring your own server

## Quick Start

> [!NOTE]
> This is a work in progress. All contributions are welcome!
>
> Currently only supports warfare mode, although other moda kinda kinda work.
>
> There is no way to accuratly track spawn points, so we guesstimate them based on player positions [WIP]

Please report and issues you encounter [here](https://github.com/sledro/HLL-RADAR/issues/new), or even better, submit a [pull request](https://github.com/sledro/HLL-RADAR/pulls) :)

![alt text](preview.png)

### Prerequisites

- Docker and Docker Compose
- HLL server with RCON access

### Setup

```bash
git clone https://github.com/sledro/HLL-RADAR.git
cd HLL-RADAR
git checkout v0.0.1
```

1. **Create your config:**

   ```bash
   cp config.example.toml config.toml
   ```

   Edit `config.toml` with your RCON server details.

2. **Start:**

   ```bash
   ./scripts/start.sh
   ```

   This builds the containers, starts everything, and creates a `./logs/` directory for application logs.

3. **Stop:**

   ```bash
   ./scripts/stop.sh
   ```

   Database data is preserved. To wipe everything: `docker compose down -v`.
