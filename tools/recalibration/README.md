# Risk recalibration jobs (PRIO-P2-RECAL)

Offline / scheduled analytics to suggest **token** and **route** profile cap updates from historical fills and paper outcomes.

## Layout

- `main.py` — entrypoint (dry-run by default): reads `RISK_API_BASE`, fetches `GET /policy/token-profiles` and `GET /policy/route-profiles`, prints a summary. Extend with DB or warehouse queries as analytics mature.
- `config.py` — shared constants.

## Usage

```bash
pip install httpx
python tools/recalibration/main.py
```

Set `RISK_API_BASE` (e.g. `http://127.0.0.1:3000`) when the risk-service is running.
