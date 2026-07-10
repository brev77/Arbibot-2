# Arbibot 2 — Domain Glossary (Ubiquitous Language)

**Назначение:** единый канон доменных терминов проекта. Снижает verbosity и jargon-drift агентов/разработчиков: каждый термин зафиксирован один раз, обсуждение сложных flows опирается на определения здесь, а не переинтерпретирует их с нуля.

**Отношение к `AGENTS.md`:** `AGENTS.md` = **операционные инструкции** (что запускать, порты, env vars, BFF routes, npm-скрипты). `CONTEXT.md` = **чистый глоссарий** (что термины значат в домене). Без перекрытия: file paths, env vars, миграции, портов — здесь НЕТ.

**Правило поддержки:** при разрешении/уточнении любого термина в обсуждении — обновляй определение здесь inline. Не дублируй термины между категориями; если термин перетекает, выбери одну категорию и сошлись на него. Определения — одно-два предложения, без implementation details.

---

## Architectural Invariants

- **Single-writer** — каждый доменный агрегат имеет ровно один owning-сервис, уполномоченный его мутировать; никакой другой сервис не пишет его таблицы напрямую.
- **Reservation-first** — капитал должен быть зарезервирован (выдан reservation token) ДО того, как план можно армить или исполнять.
- **Versioned state transitions** — доменные агрегаты проходят определённые lifecycle-состояния с versioning; переход требует проверки версии (optimistic concurrency).
- **Idempotent commit** — повторная доставка события производит доменный эффект ровно один раз; гарантируется inbox + state checks.
- **Same-transaction outbox** — outbox-запись вставляется в той же DB-транзакции, что и announce'ируемое изменение агрегата.
- **Source of Truth (SoT)** — authoritative state живёт в доменных сервисах и PostgreSQL, никогда в агенте/UI-слое.
- **Double GET** — re-fetch резервации непосредственно перед мутацией для закрытия time-of-check/time-of-use race (TOCTOU).

## Trading & Execution

- **Opportunity** — агрегат (owned by opportunity-service), представляющий обнаруженную ценовую разницу, эксплуатируемую между venues.
- **Instrument** — canonical normalized representation торгуемого актива (owned by canonical-market-service).
- **Route** — canonical пара/путь инструментов и venues, определяющий как opportunity реализуется.
- **Venue / VenueRef** — конкретная биржа или liquidity venue, на которую ссылается instrument/route.
- **MarketSnapshot** — point-in-time наблюдение рыночных данных (owned by market-intake-service); источник SnapshotUpdated.
- **ExecutionPlan** — агрегат (owned by execution-orchestrator), представляющий multi-leg arbitrage execution и его lifecycle.
- **ExecutionLeg** — одиночный направленный trade-step внутри ExecutionPlan, отслеживаемый через собственное fill-state.
- **Arm (Arming)** — переход, блокирующий план для execution после валидации reservation и risk decision; эмитит PlanArmed.
- **Execute (Execution)** — фаза/state, где legs фактически сабмитятся в venues.
- **Partial fill** — состояние leg (partiallyFilled), где исполнена только часть intended quantity; сигнал для playbook.
- **Unwinding** — восстановление/нейтрализация неполной или провалившейся arbitrage-позиции.
- **Hedging** — открытие offsetting позиции для снижения exposure.
- **Playbook / Runbook** — предопределённая последовательность шагов для оператора/агента при инциденте или сценарии.
- **Paper trading** — режим, исполняющий полный pipeline против virtual capital для валидации поведения и сбора статистики до риска реальных средств.
- **Live trading** — режим с реальным капиталом; предшествуется paper trading и minimal-capital rollout.

## Capital

- **CapitalReservation** — агрегат (owned by capital-service), представляющий капитал, зарезервированный под конкретный план до execution.
- **Reservation token** — handle, выдаваемый capital-service, доказывающий валидность reservation; требуется для arm плана.
- **Reserve / Release (capital)** — операции: claim капитала под план и освобождение, когда больше не нужно.
- **Virtual capital** — симулированные средства, используемые во время paper trading.
- **Capital exposure** — сумма at-risk funded amount; открытый mismatch на funded-плане трактуется как exposure до подтверждения portfolio/finance.
- **Capital ceiling** — верхняя граница deployed/allocated капитала, управляемая policy-конфигурацией.
- **Max-exposure guard** — atomic capital check, предотвращающий превышение суммы активных reservations над configured ceiling per chain/token/route.

## DEX & AMM

- **pool** — liquidity pool на AMM (Uniswap V2/V3, SushiSwap), хранящий парные token reserves, против которых priced swaps.
- **AMM (Automated Market Maker)** — smart-contract market, алгоритмически pricing'ящий трейды из reserves, а не из order book.
- **router** — DEX entry-point контракт (UniV2/V3/Sushi router), orchestrating swaps и multi-hop paths.
- **liquidity tier** — классификация pool/token по глубине, определяющая slippage tolerance и notional cap для трейдов через него.
- **adapter** — per-DEX (UniV2/UniV3/Sushi) и per-bridge (Across/Stargate/native) компонент, переводящий execution legs в protocol-specific contract calls.
- **slippage tolerance** — максимальное приемлемое неблагоприятное движение цены между quote и execution, gating swap.
- **minimumAmountOut (minAmountOut)** — floor получаемых токенов, захардкоженный в swap-вызов; транзакция revert'ит вместо overpay при движении цены.
- **price impact** — сдвиг цены pool, вызванный собственным размером трейда относительно reserves; отдельно от time-based slippage.
- **cumulative slippage** — суммарный slippage exposure всех legs multi-leg плана; должен оставаться ниже ожидаемой маржи, иначе план reject'ится.
- **deadline** — bound валидности swap-вызова (обычно block.timestamp + 120s), после которого pending-транзакция недействительна.
- **approve / allowance** — ERC20-операция, дающая DEX router или bridge контракту permission тратить up to заданный token amount от имени wallet.
- **revoke** — сброс ERC20 allowance до 0 после completed/failed leg для удаления standing spend authorization.
- **MAX_UINT256** — значение "infinite approval" (2^256 − 1); convenience, но leakage risk без revoke; default — exact-amount approval.

## On-chain & Wallet

- **EOA (Externally Owned Account)** — self-custody key-controlled wallet (execution-кошелёк бота), в отличие от contract wallet.
- **KeyVault** — encrypted secret store (KeyVaultService), decrypt'ящий wallet keys in-memory и возвращающий готовый signer, никогда raw plaintext, в calling code.
- **wallet key** — private signing credential, хранимый encrypted at rest и referenced by keyId.
- **encrypted-at-rest** — свойство: wallet keys persist'ятся только в ciphertext, decrypt'ятся transiently для signing.
- **key rotation** — операционная процедура замены wallet signing key (audit-trailed, operator-gated).
- **key fingerprint** — short hash публичного ключа, используемый в логах для идентификации ключа без его раскрытия.
- **signer** — signing handle (ethers.Wallet), возвращаемый KeyVault; signs transactions без exposure raw key material.
- **nonce** — per-account sequential transaction counter; mishandling в parallel leg signing → replay/replacement транзакций.
- **gas** — on-chain execution fee; estimated per EIP-1559 до broadcast.
- **maxFeePerGas** — EIP-1559 price cap (base fee + priority fee), который транзакция готова заплатить.
- **priority fee (maxPriorityFeePerGas)** — tip-часть EIP-1559 gas, платимая validators для incentivize inclusion.
- **confirmation** — транзакция mined и признана с chain-specific числом confirmations.
- **finality** — точка, после которой block цепи считается irreversible; bridge adapters ждут chain-specific thresholds до marking transfer completed.
- **finality threshold** — chain-specific confirmation count (Ethereum ~12, Optimism 2000+ blocks, BNB ~15), gating когда transfer trusted as final.
- **reorg (reorganization)** — цепь переупорядочивает blocks после их предварительного принятия; может инвалидировать transfers, помеченные completed слишком рано.
- **mempool** — pending-transaction queue, где unconfirmed trades видны MEV-ботам.
- **private mempool** — защищённый submission path (Flashbots-style), скрывающий транзакцию от public mempool до inclusion.
- **MEV (Maximal Extractable Value)** — value, извлекаемая reordering/inserting транзакций вокруг target trade.
- **front-running** — MEV-атака: бот покупает ahead of known incoming trade, толкая цену вверх.
- **sandwich** — combined front-run + back-run атака, bracketing victim swap для extraction его margin.

## Cross-chain / Bridge

- **bridge** — протокол (Across, Stargate, native L2), перемещающий assets между EVM chains через relay mechanism.
- **bridge leg** — вариант execution-leg (leg_type = bridge), представляющий одиночный cross-chain hop внутри плана.
- **multi-leg plan** — execution plan из последовательных legs (swap и/или bridge), конструируемый MultiLegPlanBuilder, scored по cumulative slippage и exposure.
- **bridge transfer** — tracked entity одного cross-chain движения со state machine: pending → relaying → confirming → completed | failed | timed_out.
- **relay / relayer** — off-chain оператор (bridge protocol side), submit'ящий и forwarding transfer на destination chain; backlog → stuck transfers.
- **optimistic verification** — bridge-механизм (Across), где relayer submit'ит и ждёт challenge period до finality.
- **challenge period** — wait window (native L2 L2→L1 до 7 дней) до claimable withdrawal.
- **bridge replay / double-spend** — угроза re-submit/re-claim bridge message; mitigated unique message-id constraints + idempotency keys.
- **false finality** — failure mode: trusting transfer как completed до его chain-specific finality threshold, оставляя vulnerable к reorg.
- **idempotency key** — deterministic key, enforcing one-shot submission bridge/leg (напр. planId:legIndex:bridgeKey).
- **force unwind** — emergency procedure восстановления stranded capital из unresponsive bridge, требующая two-person operator approval.

## Risk & Policy

- **RiskDecision** — агрегат (owned by risk-service), фиксирующий risk verdict (approved/denied) для opportunity/action.
- **Risk-checked** — opportunity lifecycle state, достигаемый после RiskDecisionIssued события, подтверждающего approved decision.
- **risk policy** — configurable rule set (DexRiskPolicyService), enforcing per-chain/token/route exposure limits до execution legs.
- **riskMode** — strictness mode, чьи thresholds compose с profile caps в adaptive-risk slice.
- **token profile** — per-instrument record, несущий max_notional_usd, используемый как liquidity/size proxy и input в watchlist tiering.
- **route profile** — per-routeKey record, несущий max_notional_usd и другие caps, bounding route sizing.
- **route scoring** — append-only [0,1] score per route, computed из rolling approval ratio + notional factor (single-writer: risk-service).
- **watchlist tier** — hot/warm/cold классификация per instrument key на основе token-profile notional thresholds.
- **adaptive risk** — capability, где profile caps и riskMode thresholds compose динамически, а не из single static limit.

## Paper Quality & Promotion

- **Promotion** — выпуск token/strategy из paper в live review; tracked через paper promotion candidates.
- **promotion candidate** — paper-only token/instrument в очереди на review к live trading; никогда auto-promoted.
- **qualityTier** — categorical grade, присвоенный paper promotion candidate, summarizing его observed behavior.
- **qualityScore** — numeric quality metric на promotion candidate, derived из paper trade success, drift, route score signals.
- **drift sample** — measured basis-point deviation между paper и reference execution prices, агрегированная по windows.
- **drift gate** — suggested promotion criterion: average drift ниже 30 bps over 15-минутного window.
- **paper capital reservation** — virtual, paper-only reservation, mirroring live reservation mechanics без touching real funds.
- **paper/live contamination** — критический риск: paper path импортирует live wallet/KeyVault модули и случайно двигает real funds; предотвращается import-graph CI checks + bounded contexts.

## Event / Messaging

- **Transactional outbox** — table, где domain events записываются в той же транзакции, что и изменение агрегата, decoupling publishing от write.
- **Inbox** — consumer-side table, keyed by (consumer_id, message_id), делающая processing idempotent и detect'ящая duplicate deliveries.
- **Relay** — процесс, polls unread outbox rows и delivers их consumer'ам (in-DB) или в Kafka, marking processed_at только после подтверждения domain effect.
- **Event envelope** — полная message structure (messageId, eventName/event_type, entityType, payload) в каждой outbox/Kafka-записи.
- **Correlation id** — identifier, threading logical operation через сервисы; required на всех mutations через Operator API.
- **Message id** — globally unique per-event identifier, guaranteeing deduplication через систему.
- **Dead-letter** — terminal state для outbox/inbox row, который не может быть processed (unknown event type, exhausted retries, duplicate-vs-domain conflict).
- **At-least-once delivery** — delivery semantics, где message может быть redelivered; made safe consumer idempotency.
- **processed_at** — marker на outbox row, set только после успешного применения domain effect.
- **relayGate** — serialization guard, предотвращающий два concurrent relay polls от открытия второй delivery для того же row.

## Config & Operations

- **Policy configuration** — centralized versioned key-value конфигурация (со scope и history/rollback), owned by config-service как single writer.
- **config key** — namespaced string (dex.filters, dex.limits, dex.live, risk.evaluation, paper.discovery, intake.throttling), под которой JSON config value хранится в config-service.
- **config scope** — axis resolution (global / environment / tenant), на которой config value применяется.
- **effective value** — resolved configuration после применения scope precedence, возвращается /effective endpoint.
- **draft / active status** — staged authoring flow: risky keys authored как drafts затем activated, а не edited live.
- **approveReason** — mandatory justification в body запроса, мутирующего sensitive policy keys (risk.*, execution.*, capital.*).
- **operator approval** — required human authorization gate на любой operator-visible mutation (config change, retry, force unwind), audit-trailed.
- **Approve-required / approval-gated** — policy, требующая explicit operator confirmation перед sensitive mutation (safe-mode, sensitive policy keys).
- **Safe mode** — restricted control-plane state, pausing/limiting trading activity; engageable только как approve-required action; enforcement в execution-orchestrator, не только в UI.
- **Kill-switch** — emergency stop для trading activity; для DEX — config-driven (dex.limits.killSwitch) fast halt, блокирующий новые DEX/cross-chain plans без redeploy.
- **Degradation** — partial-loss-of-function state (напр. HERMES indicator: Connected / Degraded / Down).
- **Rollback** — operational reversal миграции или config change; stratified в четыре levels от seed-only (low risk) до full DEX removal (extreme).
- **forward-only migration** — preferred principle: additive, idempotent schema changes над destructive rollbacks.

## Reconciliation & Incidents

- **Reconciliation** — periodic comparison system-tracked state vs on-chain/portfolio reality; single-chain и cross-chain variants.
- **Mismatch** — detected inconsistency между completed/executing plan и portfolio positions, classified by kind.
- **completed_plan_missing_portfolio** — mismatch kind: completed plan без соответствующего portfolio position row.
- **executing_plan_legs_filled_not_completed** — mismatch kind: все legs filled, но план не достиг terminal state.
- **Incident** — operator-facing unit, tracking mismatch/operational event через investigating → resolved states.
- **Drift (paper vs live)** — divergence между paper-mode и live-mode behavior/outcomes.
- **Brief (incident brief)** — concise AI-generated summary инцидента со linked execution/route context.
- **Daily digest** — scheduled paper-trading summary, surfacing token shortlist, risk notes, route quality, drift.
- **terminal state** — non-recoverable bridge/leg status (failed, timed_out), требующий explicit operator approval перед retry.

## HERMES / Agent

- **HERMES** — external self-hosted agent/automation layer, предоставляющий operator channels, sessions, skills, control UI; никогда source of truth.
- **Operator API** — explicit, RBAC- и approval-enforced surface, через который все reads/writes (включая agent's) должны flow; hidden internal URLs запрещены.
- **Skill (agent)** — markdown-defined operational capability, runnable агентом (напр. investigate-incident, safe-mode-check).
- **Allow-list (agent operations)** — bounded set operations, разрешённых assistant; calls вне него reject'ются.
- **MCP (Model Context Protocol)** — stdio protocol, bridging agent process к Hermes Gateway tools.
- **Two-key approval** — dual authorization, требуемая перед выдачей агенту service token шире dashboard admin role.

## Chain / Token types (@arbibot/contracts-eth)

- **ChainId** — type-safe enum поддерживаемых EVM chain identifiers (Ethereum, Arbitrum, Base, BNB Chain; mainnet/testnet variants).
- **Address** — type-safe branded string (0x + 40 hex chars) для EVM account/contract addresses, с validation и normalization helpers.
- **TxHash** — 66-character hex identifier on-chain transaction, tracked per source/destination chain на bridge transfers.
- **ZERO_ADDRESS** — sentinel 0x000...000 для safety checks (напр. detecting missing token или native-asset routing).
- **bridge addresses** — per-protocol (Across/Stargate/native) и per-chain contract address sets, используемые adapters для resolve spoke pools, routers, standard bridges.
