# D4-A-6-TLS — TLS-сертификаты для прод-хоста + (опц.) ACME

| Поле | Значение |
|------|----------|
| **depends_on** | — |
| **risk_level** | `low` |
| **estimated_hours** | 2 |
| **status** | `done` |

## Контекст (из ревью)
`infra/nginx/ssl/` содержит только `.gitkeep`. Operator должен сам класть `fullchain.pem` + `privkey.pem`. Let's Encrypt/cert-manager не подключены (есть только `tools/generate-tls-certs.sh` — self-signed для тестов). HSTS в `infra/nginx/nginx.conf:84` закомментирован (P9).

## Outputs
- `docs/deployment-guide.md` — раздел «TLS для прод-хоста»:
  - Для paper на изолированном хосте: либо реальный сертификат (Let's Encrypt), либо self-signed + доверие в браузере
  - Порядок: получить `fullchain.pem` + `privkey.pem` → положить в `infra/nginx/ssl/` → `docker compose up -d nginx`
- `infra/nginx/nginx.conf` — раскомментировать HSTS после подтверждения сертификата (строка 84): `add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;`
- **(Опц., ADR)** `infra/` — добавить ACME-автоматизацию (certbot sidecar или Traefik/Let's Encrypt), решить в ADR; для paper можно отложить

## Acceptance
- [ ] Документ описывает, откуда брать сертификат для прод-хоста (Let's Encrypt/manual)
- [ ] После установки сертификата `https://<host>/` работает без browser-warning
- [ ] HSTS включён в prod (после подтверждения, что HTTPS стабилен)
- [ ] `infra/nginx/ssl/*.pem` в `.gitignore` (уже есть — проверить)

## Edge Cases
- Self-signed для paper: задокументировать импорт CA в браузер оператора
- Renewal: для manual Let's Encrypt — cron `certbot renew` + reload nginx (документировать)

## Test Commands
```bash
# Self-signed для теста (уже есть скрипт)
bash tools/generate-tls-certs.sh
# Проверка, что nginx подхватывает
docker compose -f infra/docker-compose.prod.yml up -d nginx
curl -k https://localhost/
```

## Rollback
`git checkout -- infra/nginx/nginx.conf docs/deployment-guide.md`
