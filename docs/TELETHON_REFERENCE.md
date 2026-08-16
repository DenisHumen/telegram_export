# Telethon Reference for a Telegram Channel Exporter

**Verified against `telethon==1.44.0`** (latest stable on PyPI at time of writing; wheel downloaded and
source read directly). Every signature below is copied from the installed package source, not from memory.
Paths refer to files inside the `telethon` package.

> ⚠ **Project-status note:** `github.com/LonamiWebs/Telethon` was **archived read-only on 2026-02-21** and
> development moved to **codeberg.org/Lonami/Telethon**; the README warns the GitHub mirror "may be deleted
> in the future". PyPI releases continue. Pin your version (`telethon==1.44.0`), vendor a copy if this is
> load-bearing, and point issue links at Codeberg.

Install extras worth having:

```
pip install telethon
pip install cryptg      # C AES-IGE -> 10x+ faster downloads. Telethon explicitly recommends it in download_media docstring.
pip install pillow      # only needed for thumbnail generation on upload
pip install aiohttp     # only needed for WebDocument media (rare)
```

---

## 0. Client construction (telethon/client/telegrambaseclient.py:244)

```python
TelegramClient(
    session: typing.Union[str, pathlib.Path, Session],
    api_id: int,
    api_hash: str,
    *,
    connection: typing.Type[Connection] = ConnectionTcpFull,
    use_ipv6: bool = False,
    proxy: typing.Union[tuple, dict] = None,
    local_addr: typing.Union[str, tuple] = None,
    timeout: int = 10,
    request_retries: int = 5,
    connection_retries: int = 5,
    retry_delay: int = 1,
    auto_reconnect: bool = True,
    sequential_updates: bool = False,
    flood_sleep_threshold: int = 60,
    raise_last_call_error: bool = False,
    device_model: str = None,
    system_version: str = None,
    app_version: str = None,
    lang_code: str = 'en',
    system_lang_code: str = 'en',
    loop: asyncio.AbstractEventLoop = None,
    base_logger: typing.Union[str, logging.Logger] = None,
    receive_updates: bool = True,
    catch_up: bool = False,
    entity_cache_limit: int = 5000,
)
```

Key behaviours for an exporter backend:

* `flood_sleep_threshold=60` (default). `FloodWaitError` with `e.seconds <= threshold` is **swallowed and
  slept through automatically** inside `client/users.py:_call`. Only longer waits propagate to your code.
  Set it to `0` if you want to handle every flood wait yourself; capped internally at 24h
  (`telegrambaseclient.py:494`).
* Telethon also *pre-empts* floods: it remembers `self._flood_waited_requests[CONSTRUCTOR_ID] = now + seconds`
  and will raise/sleep **before** even sending a request of the same type (`users.py:47-57`). Waits under
  3 seconds are ignored.
* `receive_updates=False` (`_no_updates`) wraps every request in `InvokeWithoutUpdatesRequest`. Recommended
  for a pure exporter — saves bandwidth and avoids update-loop work. **But** `QRLogin.wait()` relies on the
  `UpdateLoginToken` update, so do **not** disable updates on a client you intend to QR-log-in.
* `self._loop` is captured on the first `connect()`; calling anything from a different event loop raises
  `RuntimeError('The asyncio event loop must not change after connection ...')` (`users.py:33-35`,
  `telegrambaseclient.py:527`).

---

## 1. Phone login flow

### 1.1 `send_code_request` (telethon/client/auth.py:409)

```python
async def send_code_request(
        self,
        phone: str,
        *,
        force_sms: bool = False,
        _retry_count: int = 0) -> 'types.auth.SentCode'
```

Returns a **`telethon.tl.types.auth.SentCode`**:

```python
auth.SentCode(
    type: TypeSentCodeType,        # SentCodeTypeApp / Sms / Call / FlashCall / MissedCall /
                                   # FragmentSms / EmailCode / FirebaseSms / SmsWord / SmsPhrase ...
    phone_code_hash: str,          # <-- the token you must feed back into sign_in
    next_type: TypeCodeType = None,
    timeout: int = None,           # seconds; how long to wait before the *next* delivery method is allowed
)
```

* `phone_code_hash` is an **opaque server-side handle for this particular login attempt**. It is bound to
  the phone number *and to the MTProto auth key / DC of the connection that issued it*. It is **not** a
  hash you can compute yourself.
* **Validity — there is NO documented TTL.** ⚠ The "5 minutes" figure that circulates online appears only in
  blog/SEO content, never on core.telegram.org. `auth.sentCode.timeout` is documented as *"Timeout for
  reception of the phone code"*, i.e. when `next_type` / `auth.resendCode` becomes appropriate — **not** the
  code lifetime. Treat the hash as short-lived and single-use: on `PhoneCodeExpiredError`, call
  `send_code_request` again for a fresh one. (https://core.telegram.org/constructor/auth.sentCode)
* ⚠ **Telegram invalidates the code server-side if the user forwards/sends it inside Telegram.** Verbatim
  from https://core.telegram.org/api/auth: *"Telegram's servers will automatically invalidate login codes if
  they are sent by the user to another Telegram chat, either by forwarding them or by sending them inside of
  a message."* Tell your users to type the code, never paste-forward it. (Clients are additionally expected
  to call `account.invalidateSignInCodes` when such a message from service user `777000` is
  forwarded/screenshotted.)
* ⚠ **Login-attempt flood limit is per phone number**: *"Each phone number is limited to only a certain
  number of login attempts per day (e.g. 5, but this is subject to change)"*. Usefully, *"logins with the
  same phone number with which the `api_id` was registered have more generous flood limits"* — so register
  the api_id on the number you use for your own testing.
* ⚠ Telegram sometimes returns `PHONE_CODE_EXPIRED` where you'd expect `PHONE_CODE_INVALID` (notably for a
  wrong code on an unoccupied number, and when re-requesting with a stale cached hash). Handle both
  identically: restart the code request. (Telethon issue #3185)
* Telethon caches it: `self._phone_code_hash[phone] = result.phone_code_hash` (auth.py:464) and
  `self._phone = phone`. `sign_in` will fall back to that cache if you omit `phone_code_hash`
  (`_parse_phone_and_hash`, auth.py:254).
* `force_sms=True` is **deprecated and a no-op** since Telethon 1.x/#4050 — it emits a `UserWarning` and is
  forced back to `False` (auth.py:436-438). Third-party clients can no longer force SMS.
* `client.sign_up()` **raises `ValueError` unconditionally** now (auth.py:371-383) — third-party apps cannot
  register new accounts. If the number has no account you get `PhoneNumberUnoccupiedError` and there is
  nothing you can do.

### 1.2 `sign_in` (telethon/client/auth.py:270)

```python
async def sign_in(
        self,
        phone: str = None,
        code: typing.Union[str, int] = None,
        *,
        password: str = None,
        bot_token: str = None,
        phone_code_hash: str = None
) -> 'typing.Union[types.User, types.auth.SentCode]'
```

Dispatch logic (exact, from source):

| call | behaviour |
|---|---|
| already authorized | returns `await self.get_me()` immediately (an extra RPC round-trip on **every** call) |
| `phone` only, no `code`/`password` | **sends the code** and returns `auth.SentCode` — *not* a `User` |
| `code` given | `auth.SignInRequest(phone, phone_code_hash, str(code))` |
| `password` given | `account.GetPasswordRequest()` then `auth.CheckPasswordRequest(SRP(pwd, password))` |
| `bot_token` given | `auth.ImportBotAuthorizationRequest` |
| nothing | `ValueError` |

On `PhoneCodeExpiredError` Telethon pops the cached hash (`self._phone_code_hash.pop(phone)`) and re-raises.

**2FA:** if the account has a cloud password, `sign_in(phone, code=...)` raises
`telethon.errors.SessionPasswordNeededError`. Then, **on the same client**:

```python
from telethon.errors import SessionPasswordNeededError

try:
    user = await client.sign_in(phone=phone, code=code, phone_code_hash=hash_)
except SessionPasswordNeededError:
    user = await client.sign_in(password=cloud_password)   # phone not required
```

`sign_in(password=...)` needs no phone/code. Wrong password -> `telethon.errors.PasswordHashInvalidError`.

### 1.3 Exception import paths (all re-exported from `telethon.errors`)

| Exception | Canonical module | Base / HTTP code |
|---|---|---|
| `telethon.errors.SessionPasswordNeededError` | `telethon.errors.rpcerrorlist` | `UnauthorizedError` (401) |
| `telethon.errors.PhoneCodeInvalidError` | `telethon.errors.rpcerrorlist` | `BadRequestError` (400) |
| `telethon.errors.PhoneCodeExpiredError` | `telethon.errors.rpcerrorlist` | `BadRequestError` (400) |
| `telethon.errors.PhoneCodeEmptyError` | `telethon.errors.rpcerrorlist` | `BadRequestError` (400) |
| `telethon.errors.PhoneCodeHashEmptyError` | `telethon.errors.rpcerrorlist` | `BadRequestError` (400) |
| `telethon.errors.PhoneNumberInvalidError` | `telethon.errors.rpcerrorlist` | `BadRequestError` (400) |
| `telethon.errors.PhoneNumberBannedError` | `telethon.errors.rpcerrorlist` | `BadRequestError` (400) |
| `telethon.errors.PhoneNumberFloodError` | `telethon.errors.rpcerrorlist` | `BadRequestError` (400) |
| `telethon.errors.PhoneNumberUnoccupiedError` | `telethon.errors.rpcerrorlist` | `BadRequestError` (400) |
| `telethon.errors.PasswordHashInvalidError` | `telethon.errors.rpcerrorlist` | `BadRequestError` (400) |
| `telethon.errors.FloodWaitError` (`.seconds`) | `telethon.errors.rpcerrorlist` | `FloodError` (420) |
| `telethon.errors.ApiIdInvalidError` | `telethon.errors.rpcerrorlist` | `BadRequestError` (400) |
| `telethon.errors.AuthRestartError` | `telethon.errors.rpcerrorlist` | `ServerError` (500) — Telethon retries up to 3x internally |

Prefer `from telethon import errors` + `errors.Xxx` over `from telethon.errors import Xxx` — see the
`TimeoutError` shadowing gotcha in §10.

### 1.4 Long-running FastAPI backend: must the client stay alive between HTTP requests?

**Yes — keep one live `TelegramClient` object per in-flight login, in one process, on one event loop.**

Reasons, all verifiable in source:

1. `phone_code_hash` is bound to the MTProto **auth key + DC** that issued `auth.sendCode`. A brand-new
   `TelegramClient` with a fresh empty session negotiates a *new* auth key, so the hash is meaningless there
   (`AUTH_KEY_UNREGISTERED` / `PHONE_CODE_INVALID`).
2. Telethon stores the hash in client memory (`self._phone_code_hash`, `self._phone`) — a new object loses it
   unless you pass `phone_code_hash=` explicitly.
3. `self._loop` is pinned on first `connect()`; a client created in one loop cannot be used from another.

Practical pattern for FastAPI:

```python
# module-level registry, one asyncio loop (uvicorn's), no threads
LOGINS: dict[str, TelegramClient] = {}   # login_session_id -> live client

@app.post("/auth/send_code")
async def send_code(phone: str):
    client = TelegramClient(StringSession(), API_ID, API_HASH)
    await client.connect()                       # auth key negotiated here
    sent = await client.send_code_request(phone)
    sid = secrets.token_urlsafe(16)
    LOGINS[sid] = client                         # keep it ALIVE
    return {"login_id": sid, "phone_code_hash": sent.phone_code_hash,
            "type": type(sent.type).__name__, "timeout": sent.timeout}

@app.post("/auth/sign_in")
async def sign_in(login_id: str, code: str):
    client = LOGINS[login_id]
    try:
        await client.sign_in(phone=phone, code=code, phone_code_hash=hash_)
    except SessionPasswordNeededError:
        return {"needs_password": True}
    return {"session": StringSession.save(client.session)}
```

**Escape hatch if you truly cannot keep the object alive** (e.g. multiple workers): the auth key is written
into the session as soon as `connect()` returns —
`self.session.auth_key = self._sender.auth_key` (`telegrambaseclient.py:571`). So you *can*
`StringSession.save(client.session)` **after `connect()` but before login**, stash that string plus the
`phone_code_hash` in Redis, and rebuild `TelegramClient(StringSession(s), ...)` in another worker to finish
`sign_in`. The auth key and DC are identical, so the hash stays valid. Add a TTL and sticky routing anyway;
the live-object approach is far less fragile.

Always add a reaper that `await client.disconnect()`s abandoned login clients.

---

## 2. QR login flow

### 2.1 `qr_login` (telethon/client/auth.py:491)

```python
async def qr_login(self, ignored_ids: typing.List[int] = None) -> telethon.tl.custom.qrlogin.QRLogin
```

`ignored_ids` is passed to `auth.ExportLoginTokenRequest(api_id, api_hash, except_ids)` — list of already
logged-in user IDs, to stop the user scanning into an account you already have.

### 2.2 `QRLogin` (telethon/tl/custom/qrlogin.py) — full API

```python
class QRLogin:
    async def recreate(self) -> None            # re-issues auth.exportLoginToken, replaces token/url/expires
    @property token   -> bytes                  # raw auth.loginToken.token
    @property url     -> str
    @property expires -> datetime.datetime      # tz-aware UTC, straight from auth.loginToken.expires
    async def wait(self, timeout: float = None) # -> types.User ; raises asyncio.TimeoutError
```

**URL format** — exact source (qrlogin.py:57):

```python
'tg://login?token={}'.format(
    base64.urlsafe_b64encode(self._resp.token).decode('utf-8').rstrip('=')
)
```

i.e. **base64url of the raw token bytes with `=` padding stripped**. Render *that string* into the QR image
yourself (`qrcode`, `segno`, …); Telethon deliberately does not generate images.

**Expiry**: `expires` is whatever the server sent in `auth.loginToken.expires`. Telegram documents the token
as lasting **"usually 30 seconds"** (https://core.telegram.org/api/qr-login) and mandates:
*"After the expiration of the current QR code, the `auth.exportLoginToken` method must be recalled and a new
QR code must be generated automatically."* Never hardcode the number — read `qr.expires` and compute
`(qr.expires - datetime.datetime.now(datetime.timezone.utc)).total_seconds()`, which is exactly what
`wait(timeout=None)` does (qrlogin.py:91).

**The flow is push-based, not poll-based.** Telegram documents **no** polling interval: you wait for the
`updateLoginToken` update, which triggers a *second* `auth.exportLoginToken` returning
`auth.loginTokenSuccess` (or `auth.loginTokenMigrateTo`). Telethon implements exactly that — the "polling"
below is only slicing `wait()` so your coroutine stays responsive; it does not hit the network.

**What `wait()` does internally**:
1. registers a raw handler for `types.UpdateLoginToken` via `events.Raw`;
2. `await asyncio.wait_for(event.wait(), timeout)` → raises **`asyncio.TimeoutError`** if nothing happens;
3. removes the handler;
4. re-issues `auth.ExportLoginTokenRequest`;
5. if the response is `auth.LoginTokenMigrateTo` → `_switch_dc(dc_id)` then `auth.ImportLoginTokenRequest`;
6. if `auth.LoginTokenSuccess` → `_on_login(user)` and returns the `types.User`.

**2FA on QR login**: step 4/5 is where the server rejects with `SESSION_PASSWORD_NEEDED`, so
**`await qr.wait()` raises `telethon.errors.SessionPasswordNeededError`** (stated verbatim in the
`qr_login` docstring, auth.py:524-525). Handle it exactly like phone login:

```python
from telethon.errors import SessionPasswordNeededError
try:
    user = await qr.wait()
except SessionPasswordNeededError:
    user = await client.sign_in(password=cloud_password)
```

Note the user is now *scanned-in but not signed-in*; `client.sign_in(password=...)` completes it on the same
client.

**`recreate()`**: issues a fresh `auth.exportLoginToken` and swaps `token`/`url`/`expires` in place. Needed
whenever the current token expired before it was scanned. It does **not** create a new `QRLogin` object, so
you can hold one object and refresh it in a loop.

**Non-blocking polling pattern (asyncio, safe for a FastAPI backend):**

```python
import asyncio, datetime
from telethon.errors import SessionPasswordNeededError

async def qr_login_loop(client, on_url, max_seconds=300):
    qr = await client.qr_login()
    deadline = asyncio.get_running_loop().time() + max_seconds
    while asyncio.get_running_loop().time() < deadline:
        on_url(qr.url)                      # push to frontend / regenerate QR image
        try:
            return await qr.wait(10)        # short slice; keeps the coroutine responsive
        except asyncio.TimeoutError:
            pass
        except SessionPasswordNeededError:
            return None                     # caller must now call client.sign_in(password=...)
        if qr.expires <= datetime.datetime.now(datetime.timezone.utc):
            await qr.recreate()
    raise TimeoutError('QR login abandoned')
```

Two hard constraints from the source:

* `wait()` **must already be running while the QR is scanned** (docstring: "This method must be called
  before the QR code is scanned"). The event handler only exists inside `wait()`. If you scan while nobody
  is awaiting, the `UpdateLoginToken` is dropped and login never completes — you'd have to `recreate()` and
  retry. If you must decouple, run `wait()` as a long-lived `asyncio.Task` and poll the task from your HTTP
  handler:

  ```python
  task = asyncio.create_task(qr.wait())     # started immediately, survives across HTTP requests
  # /auth/qr/status handler:
  if task.done(): user = task.result()      # may raise SessionPasswordNeededError / TimeoutError
  ```
* QR login needs updates. Do **not** construct that client with `receive_updates=False`.

---

## 3. Session storage — `StringSession`

`telethon/sessions/string.py` (63 lines, whole file read).

```python
from telethon.sessions import StringSession

s   = StringSession.save(client.session)   # staticmethod-ish; works as StringSession.save(session)
cli = TelegramClient(StringSession(s), api_id, api_hash)
```

Format: `'1' + base64.urlsafe_b64encode(struct.pack('>B{ip_len}sH256s', dc_id, ip, port, auth_key))`.
Only four things are stored: **dc_id, server IP, port, 256-byte auth key**.

Consequences (all provable from the file):

* **Portable across processes and machines** — nothing machine-specific is encoded. The string *is* the
  credential; treat it like a password.
* **Nothing else is persisted.** No entity/access-hash cache, no update state, and explicitly
  **no `takeout_id`** (module docstring: *"takeout ID is not stored"*). A `StringSession` exporter therefore
  re-resolves entities on every boot and cannot resume an unfinished takeout. Use `SQLiteSession` (a file)
  if you want the entity cache + takeout id to survive restarts.
* `StringSession(string)` raises `ValueError('Not a valid string')` if the first char isn't `'1'`.
* `save()` returns `''` when there is no auth key yet (i.e. before `connect()`).
* You may override the `encode`/`decode` staticmethods to change the text encoding.

### Concurrent use of one session

* **Two `TelegramClient`s sharing one `SQLiteSession` file → `sqlite3.OperationalError: database is locked`.**
  Telethon's FAQ is blunt: *"if you need two clients, use two sessions."*
* Two clients sharing the **same auth key** (e.g. the same string in two processes) is worse than a lock
  error: MTProto `msg_id`/`seqno` state is per-connection but the server tracks the auth key. In practice you
  get dropped connections, `AuthKeyDuplicatedError` (`telethon.errors.AuthKeyDuplicatedError`), or the
  session being revoked. **One live client per session string. Enforce it with a lock/registry.**
* Serialising a `StringSession` and later restoring it in a *different* process is fine — as long as only one
  is connected at a time.

---

## 4. Dialog enumeration

```python
def iter_dialogs(
        self, limit: float = None, *,
        offset_date: 'hints.DateLike' = None,
        offset_id: int = 0,
        offset_peer: 'hints.EntityLike' = types.InputPeerEmpty(),
        ignore_pinned: bool = False,
        ignore_migrated: bool = False,
        folder: int = None,
        archived: bool = None) -> _DialogsIter
```
(`telethon/client/dialogs.py:147`; `get_dialogs(*args, **kwargs)` returns a `TotalList` instead.)
`archived=True` ⇒ `folder=1`, `archived=False` ⇒ `folder=0`, unset ⇒ everything.

### `Dialog` object (telethon/tl/custom/dialog.py)

| attribute | value |
|---|---|
| `.dialog` | raw `types.Dialog` |
| `.entity` | `User` / `Chat` / `ChatForbidden` / `Channel` / `ChannelForbidden` |
| `.input_entity` | `InputPeer*` |
| `.id` | **marked** peer id (`utils.get_peer_id`) |
| `.name` / `.title` | same object; `utils.get_display_name(entity)` |
| `.message` | last `Message` (snapshot, never updated) |
| `.date` | `message.date` |
| `.pinned` | `bool(dialog.pinned)` |
| `.folder_id`, `.archived` | `archived == (folder_id is not None)` |
| `.unread_count`, `.unread_mentions_count`, `.unread_reactions_count`, `.unread_poll_votes_count` | ints |
| `.draft` | `Draft` (never `None`) |
| `.is_user` | `isinstance(entity, types.User)` |
| `.is_group` | `Chat`/`ChatForbidden` **or** (`Channel` and `entity.megagroup`) |
| `.is_channel` | `isinstance(entity, types.Channel)` — **`True` for supergroups too!** |

**Gotcha:** `dialog.is_channel` is `True` for *any* `Channel`, i.e. supergroups included, and a megagroup has
**both** `is_group` and `is_channel` `True`. Do not use it to mean "broadcast".

### Correct type discrimination

```python
from telethon.tl import types

def classify(e):
    if isinstance(e, types.User):
        return 'bot' if e.bot else ('deleted_user' if e.deleted else 'user')
    if isinstance(e, (types.Chat, types.ChatForbidden)):
        return 'basic_group'                       # legacy group, id is -chat_id
    if isinstance(e, (types.Channel, types.ChannelForbidden)):
        if getattr(e, 'megagroup', False):
            return 'supergroup'
        if getattr(e, 'gigagroup', False):
            return 'broadcast_group'               # "gigagroup" = supergroup converted to broadcast group
        return 'channel'                           # broadcast channel; e.broadcast is True
    return 'unknown'
```

Useful `types.Channel` flags: `broadcast`, `megagroup`, `gigagroup`, `forum`, `verified`, `scam`, `fake`,
`restricted`, `noforwards`, `signatures`, `join_to_send`, `join_request`, `left`, `creator`.
Marked-id scheme (`telethon/utils.py:1005`): `user_id`, `-chat_id`, `-100<channel_id>`;
`utils.resolve_id(marked)` inverts it.

### Participant count, username, about/description, photo

`types.Channel` carries `participants_count` **only sometimes** (it is an optional flag and is usually absent
in dialog listings). `types.Chat` always has `participants_count`. The reliable source is the *full* entity:

```python
from telethon.tl.functions.channels import GetFullChannelRequest
from telethon.tl.functions.messages  import GetFullChatRequest
from telethon.tl.functions.users     import GetFullUserRequest

full = await client(GetFullChannelRequest(channel))   # -> messages.ChatFull
full.full_chat.participants_count   # int
full.full_chat.about                # description text ('' if none)
full.full_chat.admins_count, .kicked_count, .banned_count, .online_count
full.full_chat.linked_chat_id       # discussion group of a broadcast channel
full.full_chat.pinned_msg_id, .slowmode_seconds, .available_min_id, .migrated_from_chat_id
full.full_chat.chat_photo           # types.Photo (full-size), unlike entity.photo which is ChatPhoto
```

* `GetFullChatRequest(chat_id)` for legacy `Chat`, `GetFullUserRequest(user)` for `User`
  (`full_user.about` is the bio).
* Username: `entity.username` (may be `None`) plus `entity.usernames: List[types.Username]` for the
  additional/collectible usernames introduced later. Check `usernames` too, or you will miss channels whose
  primary handle lives there.
* Profile photo:
  ```python
  path = await client.download_profile_photo(entity, file='out/avatar.jpg', download_big=True)
  ```
  Signature (`downloads.py:218`):
  `download_profile_photo(entity, file=None, *, download_big=True) -> Optional[str]`.
  It **needs the full entity, not an input peer** (it calls `get_entity` if given an input type), and falls
  back to `GetFullChannelRequest(...).full_chat.chat_photo` on `LocationInvalidError`.
* Participants list: `client.iter_participants(entity, limit=None, *, search='', filter=None, aggressive=False)`
  — `aggressive` is documented as **"Does nothing. This is kept for backwards-compatibility."** Telegram caps
  the retrievable member list (~10 000, and hidden entirely if `full_chat.participants_hidden`).

---

## 5. Message iteration

```python
def iter_messages(
        self, entity: 'hints.EntityLike', limit: float = None, *,
        offset_date: 'hints.DateLike' = None,
        offset_id: int = 0,
        max_id: int = 0,
        min_id: int = 0,
        add_offset: int = 0,
        search: str = None,
        filter: TypeMessagesFilter | Type[TypeMessagesFilter] = None,
        from_user: 'hints.EntityLike' = None,
        wait_time: float = None,
        ids: int | Sequence[int] = None,
        reverse: bool = False,
        reply_to: int = None,
        scheduled: bool = False) -> _MessagesIter | _IDsIter
```
(`telethon/client/messages.py:347`)

### Exact offset semantics

* Default order is **newest → oldest**. `reverse=True` gives **oldest → newest**.
* `offset_id` — exclusive. Default direction: only messages *older* than it. With `reverse=True`, only
  messages *newer* than it.
* `offset_date` — exclusive; messages *previous to* this date (meaning also flips with `reverse`).
* `max_id` — "all messages with a **higher (newer) ID or equal** to this will be excluded".
* `min_id` — "all messages with a **lower (older) ID or equal** to this will be excluded".
  **Both bounds are exclusive.**
* With `reverse=True`, `min_id` "becomes equivalent to `offset_id`" (docstring), because internally
  `offset_id = max(offset_id, min_id)` and then `offset_id += 1` (`messages.py:38-58`).
* **Telegram itself ignores `min_id`/`max_id` for `getHistory`** — Telethon emulates them client-side by
  translating them into offsets and stopping early (`_message_in_range`, `messages.py:241`). Comment in
  source: *"Telegram doesn't like min_id/max_id."*
* `ids=` takes precedence over everything and switches to `_IDsIter` (`channels.GetMessagesRequest` /
  `messages.GetMessagesRequest`). Missing/deleted ids yield `None` placeholders so you can zip 1:1.
* `search`, `filter` or `from_user` switch the backend from `messages.getHistory` to `messages.search`
  (or `messages.searchGlobal` when `entity=None`). `filter` + `from_user` together is documented to
  frequently trigger `RPC_CALL_FAIL`.
* `reply_to=<post_id>` iterates the comment thread of a channel post (only for broadcast channels and their
  linked megagroup; raises `telethon.errors.PeerIdInvalidError` elsewhere).

### Reliable incremental export

Store the **highest message id already exported per chat** and resume with `reverse=True` + `min_id`:

```python
async def incremental(client, entity, last_id: int):
    newest = last_id
    async for msg in client.iter_messages(entity, reverse=True, min_id=last_id, limit=None):
        yield msg                 # ascending id order, msg.id > last_id strictly
        newest = msg.id
    # persist `newest` ONLY after the batch is durably written
```

Why this and not `offset_date`: message ids in a channel are monotonically increasing and unique, dates are
not (edits, imported history, scheduled posts). Also note:

* **Edits are invisible to this scheme.** `min_id` will never re-yield an old message that was edited. If you
  care about edits, keep `msg.edit_date` per row and periodically re-scan with `ids=[...]` for a window, or
  run a full re-crawl.
* **Deletions are invisible too.** Detect them by re-fetching known ids with `ids=` and looking for `None`.
* Commit the cursor **after** the sink write, and make the sink idempotent on `(chat_id, message_id)` —
  the source itself warns duplicated ids have been observed on bad connections (`messages.py:200-204`).
* For a first full export prefer `reverse=True` from `min_id=0`: if the job dies, `min_id=last_seen` resumes
  cleanly. Descending order requires tracking a low-water `offset_id` instead, which is more error-prone.

### Rate limits & batching

* Chunk size is hardcoded: `_MAX_CHUNK_SIZE = 100` (`messages.py:10`). You always get 100 messages per RPC.
* Automatic pacing: `wait_time` defaults to **1 s between chunks when `limit > 3000`**, else 0
  (`messages.py:165-166`). For `ids=`, it defaults to **10 s when more than 300 ids** (`messages.py:294-295`).
* Docstring states the observed limit: *"Telegram's flood wait limit for `GetHistoryRequest` seems to be
  around 30 seconds per 10 requests"* — i.e. roughly 1000 messages / 30 s sustained.
* Practical exporter settings: `wait_time=1` for normal mode; leave `limit=None`, let the iterator page.
* Do not fan out many `iter_messages` over the same chat concurrently — you multiply the flood risk on one
  request type, and Telethon's `_flood_waited_requests` cache is keyed by request constructor id, so one
  flood blocks *all* your history calls anyway.

### Takeout mode

```python
def takeout(self, finalize: bool = True, *,
            contacts: bool = None, users: bool = None, chats: bool = None,
            megagroups: bool = None, channels: bool = None,
            files: bool = None, max_file_size: bool = None) -> 'TelegramClient'
async def end_takeout(self, success: bool) -> bool
```
(`telethon/client/account.py:111` / `:222`)

```python
from telethon import errors

try:
    async with client.takeout(finalize=True, channels=True, megagroups=True,
                              files=True, max_file_size=2 * 1024**3) as takeout:
        async for message in takeout.iter_messages(chat, wait_time=0):
            ...
        await takeout.download_media(message, file=path)
except errors.TakeoutInitDelayError as e:
    print('must wait', e.seconds)
```

Mechanics (read from `_TakeoutClient`, account.py:15-108):

* `takeout()` returns a **proxy object**, not a new client. `__getattr__` forwards to the real client, and
  `__call__` wraps every request in `functions.InvokeWithTakeoutRequest(takeout_id, request)`.
* `__aenter__` sends `account.InitTakeoutSessionRequest(...)` and stores `client.session.takeout_id`. All
  params default to `None`; **you must explicitly set the ones you plan to use** or the server won't
  authorise those data kinds.
* `__aexit__` sends `account.FinishTakeoutSessionRequest(success)` when `finalize=True` (or when you set
  `takeout.success = ...`). With `finalize=False` and `success=None`, the takeout id survives in
  `client.session.takeout_id` so a later run can resume — **but `StringSession` does not persist
  `takeout_id`** (§3), so this only works with `SQLiteSession`.
* Only one takeout session per account at a time; a second one invalidates the first
  (`telethon.errors.TakeoutInvalidError`: *"the takeout session has been invalidated by another data export
  session"*).
* `messages.getHistory` / `messages.search` / `channels.getMessages` require the relevant `message_*` flag
  (`chats=`, `megagroups=`, `channels=`); `upload.getFile` requires `files=True` **and** `max_file_size=`.

### `TakeoutInitDelayError` — what it really is

`telethon.errors.TakeoutInitDelayError` (subclass of `FloodError`, code 420, has **`.seconds`**) is **a
security delay, not a flood limit**. Telegram's text: *"Sorry, for security reasons, you will be able to
begin downloading your data in %d seconds. We have notified all your devices about the export request..."*
(https://core.telegram.org/method/account.initTakeoutSession)

* Observed values cluster around **24 hours** (86400, 85920, 85837, 85136, 83764 …) — it is the countdown of
  a single 24 h window, **not** a fresh penalty per attempt. Occasional much shorter values (~1.5 h) appear
  for long-established sessions.
* **The wait is skippable**: the user confirms the export prompt on another logged-in device.
* ⚠ Telethon has **no** automatic retry for it, and it is **not** covered by `flood_sleep_threshold` (that
  only kicks in inside `_call`'s `FloodWaitError` handler for waits below the threshold — 86400 s is far
  above the 60 s default anyway). Surface `e.seconds` to the user and tell them to approve on another device.

### ⚠ Does takeout actually avoid FloodWait? Probably not — this is the biggest myth here

* **Telegram never documents takeout as reducing flood limits.** https://core.telegram.org/api/takeout
  contains no mention of flood, rate, limit, or speed — only mechanics and authorization.
* The belief traces to Telethon's own hedged docstring (*"**Some** of the calls ... will have lower flood
  limits"*), which downstream tools restated until it became folklore.
* Field reports contradict it for downloads: `--takeout` still produces `FLOOD_WAIT_24`, shows no
  improvement against a sub-300 KB/s throttle, and in several reports *broke* downloads outright
  (iyear/tdl issues #778, #1153, #646, #247, #1109).
* **What takeout reliably gives you is authorization for bulk export** — it is the mechanism Telegram Desktop
  itself uses for "Export chat history". Treat it as a compliance/authorization feature with a 24 h
  activation cost, **not** as a rate-limit exemption.
* **Recommendation for this project:** do not build the exporter around takeout. Build correct FloodWait
  handling first (§10.2). If you do use takeout, use `finalize=False` + `SQLiteSession` so `takeout_id`
  persists and you pay the `TakeoutInitDelayError` cost exactly once.
* Telethon's docstring example uses `takeout.iter_messages(chat, wait_time=0)` — do **not** copy that blindly
  given the above; measure before dropping the 1 s inter-chunk sleep.

---

## 6. Media typing on `telethon.tl.custom.message.Message`

All of these are **properties returning the media object or `None`** — never booleans. Truthiness works,
`is True` does not.

| property | returns | implementation |
|---|---|---|
| `.media` | raw `MessageMedia*` (`None` if `MessageMediaEmpty`) | field |
| `.photo` | `types.Photo` | `MessageMediaPhoto`, **or** `MessageActionChatEditPhoto.photo`, **or** the web-preview's photo |
| `.document` | `types.Document` | `MessageMediaDocument`, **or** the web-preview's document |
| `.web_preview` | `types.WebPage` | `MessageMediaWebPage` |
| `.audio` | `Document` | has `DocumentAttributeAudio` **and `not attr.voice`** |
| `.voice` | `Document` | has `DocumentAttributeAudio` **and `attr.voice`** |
| `.video` | `Document` | has `DocumentAttributeVideo` |
| `.video_note` | `Document` | has `DocumentAttributeVideo` **and `attr.round_message`** (the round "кружок") |
| `.gif` | `Document` | has `DocumentAttributeAnimated` |
| `.sticker` | `Document` | has `DocumentAttributeSticker` |
| `.contact` | `MessageMediaContact` (the media itself) | |
| `.poll` | `MessageMediaPoll` (the media itself, **not** the `Poll`) | |
| `.geo` | `types.GeoPoint` | from `MessageMediaGeo` / `MessageMediaGeoLive` / `MessageMediaVenue` |
| `.venue` | `MessageMediaVenue` | |
| `.dice` | `MessageMediaDice` | |
| `.game` | `types.Game` | |
| `.invoice` | `MessageMediaInvoice` | |
| `.file` | `telethon.tl.custom.file.File` | wraps `self.photo or self.document`; `None` for polls/geo/contacts/games |

### The critical ordering gotcha

`_document_by_attribute` (message.py:1235) returns the doc on the **first matching attribute class**, and
returns `None` if the condition fails. But the categories overlap:

* a **video note** satisfies `.video` **and** `.video_note`;
* a **gif** (Telegram animation) is an mp4 and satisfies `.video` **and** `.gif`;
* an **animated/video sticker** satisfies `.sticker` and may satisfy `.video`/`.gif`.

So always test from most specific to least:

```python
def media_kind(m):
    if m.photo:      return 'photo'
    if m.video_note: return 'video_note'      # BEFORE video
    if m.gif:        return 'gif'             # BEFORE video
    if m.sticker:    return 'sticker'
    if m.voice:      return 'voice'           # BEFORE audio (voice also has DocumentAttributeAudio)
    if m.audio:      return 'audio'
    if m.video:      return 'video'
    if m.document:   return 'document'
    if m.contact:    return 'contact'
    if m.poll:       return 'poll'
    if m.geo:        return 'geo'
    if m.web_preview:return 'web_preview'
    return 'text' if m.message else 'other'
```

Second gotcha: **`.photo` and `.document` also fire on a web preview.** A plain link message whose preview
carries an image returns a truthy `.photo`. Check `m.web_preview` first if you want to treat previews
separately (`msg.media` would be `MessageMediaWebPage`).

### Ground truth on the raw attributes

```python
from telethon.tl.types import DocumentAttributeVideo, DocumentAttributeAudio

DocumentAttributeVideo(duration: float, w: int, h: int,
                       round_message=None, supports_streaming=None, nosound=None,
                       preload_prefix_size=None, video_start_ts=None, video_codec=None)

DocumentAttributeAudio(duration: int, voice=None, title=None, performer=None, waveform=None)
```

So the canonical detections are `attr.round_message` (round video note) and `attr.voice` (voice message) —
exactly what Telethon's `.video_note` / `.voice` wrap.

Bonus (layer ≥ 186): `types.MessageMediaDocument` itself now carries duplicate flags
`video`, `round`, `voice`, plus `spoiler`, `nopremium`, `ttl_seconds`, `video_cover`, `alt_documents`.
`m.media.spoiler` and `m.media.ttl_seconds` have no `Message` property — read them off `m.media`.

### `File` (telethon/tl/custom/file.py)

```python
f = message.file                 # None if no photo/document
f.media          # the underlying Photo or Document
f.name           # DocumentAttributeFilename.file_name  -> None for photos & most stickers/voice
f.ext            # mimetypes.guess_extension(mime_type) or splitext(name)[-1] or None
f.mime_type      # 'image/jpeg' hardcoded for Photo; document.mime_type otherwise
f.size           # Document.size; for Photo -> byte count of the heaviest PhotoSize
f.width / f.height   # Photo: max over sizes; Document: DocumentAttributeImageSize or ...Video
f.duration       # DocumentAttributeAudio.duration or DocumentAttributeVideo.duration
f.title / f.performer   # DocumentAttributeAudio
f.emoji          # DocumentAttributeSticker.alt  -> the sticker's emoji, e.g. '😀'
f.sticker_set    # DocumentAttributeSticker.stickerset -> an InputStickerSet (usually InputStickerSetID)
f.id             # DEPRECATED bot-API file_id via utils.pack_bot_file_id — see §7
```

**Sticker set name** requires an extra RPC — `f.sticker_set` is only an `InputStickerSetID(id, access_hash)`:

```python
from telethon.tl.functions.messages import GetStickerSetRequest
ss = await client(GetStickerSetRequest(message.file.sticker_set, hash=0))
ss.set.short_name   # 't.me/addstickers/<short_name>'
ss.set.title        # human-readable pack title
```
`types.StickerSet` also has `count`, `masks`, `emojis` (custom-emoji pack), `official`, `archived`, `thumbs`.
Cache these — packs repeat constantly and `GetStickerSetRequest` will flood-wait.

Custom emoji inside text are **not** stickers: they are `types.MessageEntityCustomEmoji(offset, length,
document_id)` in `message.entities`, and the document carries `DocumentAttributeCustomEmoji(alt, stickerset,
free, text_color)`.

---

## 7. Downloading

### `download_media` (telethon/client/downloads.py:332)

```python
async def download_media(
        self,
        message: 'hints.MessageLike',
        file: 'hints.FileLike' = None,
        *,
        thumb: typing.Union[int, types.TypePhotoSize] = None,
        progress_callback: 'hints.ProgressCallback' = None
) -> typing.Optional[typing.Union[str, bytes]]
```

* `message` may be a `Message`, a raw media object, or a bot-API `file_id` string.
* `file` may be a **path**, a **directory**, a file-like object, or the literal type `bytes`
  (`file=bytes`, no parentheses) to download in memory.
* Returns the **final path** (`str`) — which can differ from what you passed — or `bytes` for in-memory, or
  `None` if there was nothing downloadable (also `None` if `thumb=` is set but the media has no thumbnails).
* `progress_callback(received: int, total: int)` — may be a coroutine function; Telethon awaits it if
  awaitable. `total` comes from the known file size.
* Shorthand `await message.download_media(...)` (message.py:921) forwards the *whole message*, which is what
  enables the file-reference auto-refresh in §10 — **prefer it over passing `message.media`.**
* ⚠ The `msg_data` capture that powers that auto-refresh is guarded by `isinstance(message, types.Message)`
  (downloads.py:416) — and because of the patching described in §9, **a `MessageService` fails that check**.
  Service-message photos (`MessageActionChatEditPhoto`) still download, but with `date = now` and **no**
  file-reference recovery.

Filename resolution (`_get_proper_filename`, downloads.py:1027):
* exact existing file path ⇒ **overwritten**, no rename;
* directory or empty ⇒ name taken from `DocumentAttributeFilename`, else `performer - title`, else
  `'{kind}_{YYYY}-{MM}-{DD}_{HH}-{MM}-{SS}'`;
* if the computed name already exists ⇒ `name (1).ext`, `name (2).ext`, … **It never overwrites in that
  branch, so a naive re-run silently duplicates every file.** Build your own deterministic paths.

### Thumbnails only

```python
await client.download_media(msg, file='thumb.jpg', thumb=0)    # smallest
await client.download_media(msg, file='thumb.jpg', thumb=-1)   # largest (may be a VideoSize mp4!)
await client.download_media(msg, file='thumb.jpg', thumb='m')  # by PhotoSize.type string
```
`thumb` accepts `int` index, negative index, a `type` string, or a `PhotoSize`/`PhotoCachedSize`/
`PhotoStrippedSize`/`VideoSize` instance. `_get_thumb` drops `PhotoPathSize` (an SVG outline, not an image)
and re-sorts sizes because Telegram's order is unreliable. `PhotoStrippedSize`/`PhotoCachedSize` are written
**without any network call** (`_download_cached_photo_size`) — free blurred placeholders.
Documents use `document.thumbs`; photos use `photo.sizes + photo.video_sizes`.

### `iter_download` (telethon/client/downloads.py:603)

```python
def iter_download(
        self, file: 'hints.FileLike', *,
        offset: int = 0,
        stride: int = None,
        limit: int = None,          # number of CHUNKS, not bytes
        chunk_size: int = None,     # defaults to request_size
        request_size: int = 524288, # MAX_CHUNK_SIZE = 512*1024
        file_size: int = None,
        dc_id: int = None)
```
Yields `bytes` (direct path) or `memoryview` (generic path). `request_size` is clamped to a multiple of
`MIN_CHUNK_SIZE = 4096` and to `[4096, 524288]`. Async-iterable and an async context manager; call
`await stream.close()` if you break out early.

```python
with open('photo.jpg', 'wb') as fd:
    async for chunk in client.iter_download(msg.media):
        fd.write(chunk)

stream = client.iter_download(msg.media, request_size=4096)   # just the header
header = await stream.__anext__()
await stream.close()
```

`download_file(input_location, file, *, part_size_kb=None, file_size=None, progress_callback=None,
dc_id=None, key=None, iv=None)` is the lower-level variant; part size defaults via
`utils.get_appropriated_part_size`: **128 KB ≤100 MB, 256 KB ≤750 MB, 512 KB above**.

### Resume / skip already-downloaded — is there a stable id?

**Do not use `message.file.id`.** Source warning (file.py:26-30): *"This feature has not been maintained for
a long time and may not work. It will be removed in future versions"* and *"may not work under user
accounts"*.

The stable identity is the **`(document.id, access_hash)`** pair (or `(photo.id, photo.access_hash)`).
`document.id` is a global, permanent Telegram file id; `access_hash` is per-account but stable. What is
**not** stable is `file_reference` (§10) — which is exactly why you should key your dedupe store on `id`.

```python
def media_key(msg):
    d = msg.document
    if d: return ('doc',   d.id, d.access_hash, d.size, d.mime_type)
    p = msg.photo
    if p: return ('photo', p.id, p.access_hash)
    return None
```

Store `{doc_id -> local_path, sha256, bytes}`. Skip when `doc_id` is known **and** the local file exists with
the expected size. That also deduplicates forwards/reposts of the same file across chats for free.
Byte-level resume of a *partial* download is possible with `iter_download(offset=already_have)`, but the
offset must be a multiple of 4096; simplest is to download to `path.part` and rename on completion.

### Parallelising downloads safely

Architecture facts from the source:

* Telethon keeps **one exported `MTProtoSender` per remote DC**, reference-counted and shared
  (`_borrow_exported_sender`, `telegrambaseclient.py:857`). Ten concurrent `download_media` calls to the same
  DC **share one TCP connection** — you get request pipelining, not extra sockets. The sender is
  disconnected 60 s after the last borrow is returned (`_DISCONNECT_EXPORTED_AFTER = 60`).
* So `asyncio.gather` over downloads *does* help (multiple `upload.getFile` in flight), but throughput
  plateaus. **Stock Telethon effectively downloads over one connection** — this is why "Telethon is slow"
  is a common complaint and why libraries like FastTelethon exist (dynamic up to ~20 workers; its author
  warns that going beyond 20 breaks).

**⚠ What Telegram actually permits — and the real hazard is NOT FloodWait:**

* Parallel connections are **explicitly allowed and recommended, but only on media DCs**
  (https://core.telegram.org/api/errors): *"parallel connections are still allowed and actually recommended
  for media DCs"*; *"Dedicated file transfer sessions on media DCs are exempt and may always be opened in
  parallel."* Identify them via the `media_only` flag on `dcOption`.
* **`AuthKeyDuplicatedError` (406) is the thing that will kill you.** Verbatim: it is *"only emitted if any
  of the non-media DC detects that an authorized session is sending requests in parallel from two separate
  TCP connections"*, and *"the session was already invalidated by the server and the user must generate a new
  auth key and login again"* — i.e. **your stored session string is destroyed and the user must re-login.**
  The permitted allowance on your home DC is the `tmp_sessions` config value: *"Number of parallel sessions
  the client may open to the main connection of its home DC ...; if absent or ≤ 1, a single main session must
  be used."* **Never exceed it.**
* ⚠ `small_queue_max_active_operations_count` (5) and `large_queue_max_active_operations_count` (2) are
  widely misread: they cap concurrent **files** (<20 MB / >20 MB) per DC, are explicitly *soft* client-side
  limits, and say nothing about chunk-level parallelism within one file.
* Chunking rules: `upload.getFile` `limit` ≤ **1 MB**; `offset`/`limit` divisible by 4 KB; 1 MB must be
  divisible by `limit`. Telethon's `MAX_CHUNK_SIZE` is only **512 KB**, i.e. half the protocol maximum.
* Realistic uncontrolled numbers: ~0.3–0.5 MB/s single connection **without** `cryptg`, ~1–2 MB/s per
  connection with it, 7–20 MB/s aggregate multi-connection. Even Premium on official Desktop hits a ~10 MB/s
  soft ceiling.
* **No credible reports of bans caused by parallel download connections.** Over-parallelism degrades into
  FloodWait, which is recoverable — unlike `AuthKeyDuplicatedError`.

**Practical recipe:** install `cryptg` first (it is usually the single biggest win — pure-Python AES-IGE is
the bottleneck), then `asyncio.Semaphore(4..8)` around `download_media`, one `TelegramClient` per account,
and respect ~5 small / ~2 large concurrent *files* per DC. Remember the `_flood_waited_requests` cache is
keyed by request constructor, so one flood on `getFile` stalls **all** your downloads. Genuinely higher
throughput needs several media-DC sessions (or separate accounts), not more tasks on one home-DC connection.

Errors handled *for you* inside `_DirectDownloadIter._request` (downloads.py:87-139):

| error | Telethon's behaviour |
|---|---|
| `errors.TimedOutError` | sleeps `TIMED_OUT_SLEEP = 1` s and retries **once**, then re-raises |
| `errors.FileMigrateError` (has `.new_dc`) | transparently borrows a sender for the new DC and retries |
| `types.upload.FileCdnRedirect` | restarts the download against the CDN DC with the given key/iv |
| `types.upload.CdnFileReuploadNeeded` | calls `upload.ReuploadCdnFileRequest` and retries |
| `FileReferenceExpiredError` / `FilerefUpgradeNeededError` | re-fetches the message and patches the reference — **only for documents, only if `msg_data` is available** (§10) |

`FloodWaitError` is **not** handled here — it bubbles up to `_call`, which sleeps it if
`<= flood_sleep_threshold` and raises otherwise.
A CDN redirect on a **bot** account raises `ValueError` ("GetCdnFile API access for bot users is
restricted") — user accounts are fine.

### Telegram Premium and download speed

* **Yes, and it is enforced entirely server-side.** https://core.telegram.org/api/premium states plainly:
  *"Premium users have no download speed limits (i.e. they can't receive `FLOOD_PREMIUM_WAIT_X` errors when
  downloading files)."*
* **Telethon needs nothing special** — no flag, no `initConnection` change; there is no premium branch in
  `downloads.py`. The server keys off account status. Check with `(await client.get_me()).premium`.
* ⚠ **`FLOOD_PREMIUM_WAIT_X` is a throttle signal, not a penalty box.** https://core.telegram.org/api/files:
  the download speed is limited because the account lacks Premium, and *"the query must be automatically
  repeated by the client after X seconds."* Telethon maps it to `telethon.errors.FloodPremiumWaitError`
  (`.seconds`) and `_call` sleeps it like a normal `FloodWaitError` — which is correct. **Do not** put it in
  an exponential-backoff/abort path: just sleep `e.seconds` and retry inline.
* ⚠ `upload_premium_speedup_download` (default `10`) in the config is **a UI string for the "download 10x
  faster" upsell modal, not a knob** — same for `upload_premium_speedup_upload` and
  `upload_premium_speedup_notify_period`. `upload_max_fileparts_default` (4000) vs
  `upload_max_fileparts_premium` (8000) is *upload* capacity and unrelated to download speed.
* ⚠ **Premium alone often changes nothing measurable**, because stock Telethon downloads over a single
  connection. Premium raises the cap; it does not make one connection faster. Installing `cryptg` and
  parallelising is worth more than the subscription for most workloads.
* ⚠ "Telegram throttles third-party `api_id`s" is folklore — no evidence. The official client is simply far
  more parallel.

---

## 8. Grouped media (albums)

* `message.grouped_id: Optional[int]` — *"If this message belongs to a group of messages (photo albums or
  video albums), all of them will have the same value here."*
* An album is **N separate `Message` objects** with consecutive-ish ids and an identical `grouped_id`. There
  is no album object in the API.
* Exactly **one** message in the group carries the caption (`message`/`entities`) — in practice the first
  (lowest id) — and the rest have empty text. Attach the caption to the group, not to the item. Do not assume
  it is index 0 after sorting; pick `next((m for m in group if m.message), None)`.
* `grouped_id` is `None` for standalone media. Albums are at most 10 items.
* Since messages arrive in id order from `iter_messages(reverse=True)`, grouping is a simple run-length pass:

```python
import itertools

async def iter_albums(client, entity, **kw):
    buf, gid = [], None
    async for m in client.iter_messages(entity, reverse=True, **kw):
        if m.grouped_id is not None and m.grouped_id == gid:
            buf.append(m); continue
        if buf: yield buf
        buf, gid = [m], m.grouped_id
    if buf: yield buf
```

Do not assume contiguity across a chunk boundary is preserved by anything other than id order — with
`reverse=True` it is, which is another reason to export ascending. If you need robustness, just persist
`grouped_id` on every row and let the consumer group.

---

## 9. Message content

| what | how |
|---|---|
| formatted text | `message.text` — `message` re-rendered through `client.parse_mode.unparse(message, entities)`. **Default parse mode is Markdown** (`telegrambaseclient.py:417`: `self._parse_mode = markdown`), so `.text` gives you `**bold**`. Set `client.parse_mode = 'html'` for HTML, or `client.parse_mode = None` to make `.text == .message`. `None` for `MessageService`. |
| plain text | `message.raw_text` — a straight alias for `message.message`, no formatting. `None` for service messages. |
| raw field | `message.message: Optional[str]` |
| entities | `message.entities: List[types.MessageEntity]` (Bold, Italic, Code, Pre, TextUrl, Url, Mention, MentionName, CustomEmoji, Spoiler, Blockquote…). Helper: `message.get_entities_text(cls=None)` → `[(entity, inner_text), ...]` |
| **`.text` requires a client** | `Message.text` returns `self._text` and only computes it `if self._client` — a message built by raw API calls (not via friendly methods) has `_client is None` and `.text` is `None`. Use `.message` when in doubt. |
| reply | `message.reply_to: MessageReplyHeader`; convenience `message.reply_to_msg_id` (= `reply_to.reply_to_msg_id`, `None` if the reply is to a *story*). `message.is_reply` is `reply_to is not None`. `await message.get_reply_message()` fetches it. Cross-chat replies expose `message.reply_to_chat` / `.reply_to_sender`, and quoted replies carry `reply_to.quote_text` / `.quote_entities` / `.quote_offset`, plus `reply_to.reply_to_top_id` for threads. |
| forwards | `message.fwd_from: types.MessageFwdHeader` (`date`, `from_id`, `from_name`, `channel_post`, `post_author`, `saved_from_peer`, `saved_from_msg_id`, `imported`, `psa_type`). Friendly wrapper `message.forward` → `telethon.tl.custom.forward.Forward`, which copies every `MessageFwdHeader` field onto itself **and** implements `ChatGetter`/`SenderGetter`, so `message.forward.sender_id`, `await message.forward.get_sender()`, `message.forward.chat` work. `from_name` is set (and `from_id` is `None`) when the original sender hides their account. |
| reactions | `message.reactions: types.MessageReactions` with `.results: List[ReactionCount]`, `.recent_reactions`, `.can_see_list`, `.min`, `.top_reactors`. Each `ReactionCount(reaction, count, chosen_order)` where `reaction` is `ReactionEmoji(emoticon=str)` or `ReactionCustomEmoji(document_id=int)` or `ReactionPaid`. `None` when nobody reacted. |
| views / forwards count | `message.views: Optional[int]`, `message.forwards: Optional[int]` (channel posts only) |
| replies/comments count | `message.replies: types.MessageReplies` → `.replies`, `.replies_pts`, `.channel_id` (the linked discussion group), `.comments` |
| edit date | `message.edit_date: Optional[datetime]`; `message.edit_hide: bool` when the "edited" mark is suppressed |
| post author | `message.post_author: Optional[str]` — the signature shown on signed channel posts |
| pinned | `message.pinned: bool` (per-message flag). Chat-wide: `full_chat.pinned_msg_id`, or `client.iter_messages(entity, filter=types.InputMessagesFilterPinned)` |
| other flags | `out`, `mentioned`, `media_unread`, `silent`, `post`, `from_scheduled`, `legacy`, `noforwards`, `invert_media`, `offline`, `ttl_period`, `restriction_reason`, `via_bot_id`, `factcheck` |
| polls | `message.poll` is the **`MessageMediaPoll`**: `message.poll.poll` → `types.Poll(id, question: TextWithEntities, answers: List[PollAnswer], hash, closed, public_voters, multiple_choice, quiz, close_period, close_date, ...)`; `message.poll.results` → `types.PollResults(results: List[PollAnswerVoters], total_voters, recent_voters, solution, solution_entities, min, can_view_stats)`. **`Poll.question` is a `TextWithEntities`, not a `str`** (schema change) — use `poll.question.text`. Each `PollAnswer` has `.text` (also `TextWithEntities`) and `.option: bytes`. |
| service messages | Telethon merges `Message` and `MessageService` into one class **by monkeypatching** (`telethon/tl/patched/__init__.py`): `types.Message`, `types.MessageService` and `types.MessageEmpty` are all replaced by subclasses of `telethon.tl.custom.message.Message`. ⚠ Therefore **`isinstance(msg, types.Message)` is `False` for a service message** — they are siblings, not parent/child. Detect with `message.action is not None` (`message.message` / `.text` are `None` there). `message.action` is a `types.MessageAction*`: `MessageActionChatCreate`, `ChatEditTitle`, `ChatEditPhoto`, `ChatDeletePhoto`, `ChatAddUser`, `ChatDeleteUser`, `ChatJoinedByLink`, `ChannelCreate`, `ChatMigrateTo`, `ChannelMigrateFrom`, `PinMessage`, `HistoryClear`, `GameScore`, `PhoneCall`, `TopicCreate`, `TopicEdit`, `SetChatTheme`, `GroupCall`… `message.action_entities` gives the resolved users/chats for the add/delete/join/migrate actions. Note `message.photo` **does** return a photo for `MessageActionChatEditPhoto`. |
| grouped media | `message.grouped_id` (§8) |
| buttons | `message.buttons` / `await message.get_buttons()` / `message.button_count` |

### Sender: channel post vs group message

`Message` implements `SenderGetter` (`sendergetter.py`) and `ChatGetter`.

* `message.sender_id: Optional[int]` — the **marked** id, computed in `Message.__init__`:
  * if `from_id` is set → `utils.get_peer_id(from_id)`;
  * elif `post` is `True` (a broadcast channel post) → `utils.get_peer_id(peer_id)`, i.e. the
    **channel itself** (`-100…`);
  * elif it's an incoming private message → the peer;
  * else `None` (anonymous admins in groups, and channel-signed posts where Telegram omits `from_id`).
* `message.sender` — cached `User` **or `Channel`** (a group message sent "as a channel" has a `Channel`
  sender), or `None` if Telegram didn't include it.
* `await message.get_sender()` — same, but performs an API call when missing **or when the cached entity has
  `.min == True`** (a "min" entity has a display name but no username/access hash). This is a real network
  call: rate-limit it and cache by `sender_id`.
* `message.post_author` is the *string* signature for signed channel posts; the numeric sender is still the
  channel.
* Group vs channel summary:
  * **broadcast channel post** → `message.post is True`, `sender_id == chat_id` (the channel), real author
    only via `post_author` (string) or `fwd_from`.
  * **group/supergroup message** → `sender_id` is the user (`from_id`), `await message.get_sender()` gives a
    `User`; anonymous admins have `from_id` pointing at the group itself.
* `message.chat_id` / `message.chat` / `await message.get_chat()` / `message.input_chat`; predicates
  `message.is_private`, `message.is_group`, `message.is_channel`.
* `await message.get_input_chat()` can silently iterate up to 100 dialogs to resolve an unknown chat
  (`chatgetter.py:79-88`) — an expensive surprise inside a tight loop. Pass entities you already resolved.

---

## 10. Errors & resilience

All are re-exported from `telethon.errors` (`telethon/errors/__init__.py` does
`from .rpcbaseerrors import *` and `from .rpcerrorlist import *`).

| exception | module | base (code) | notes |
|---|---|---|---|
| `FloodWaitError` | `telethon.errors.rpcerrorlist` | `FloodError` (420) | **`.seconds: int`**. Auto-slept when `<= client.flood_sleep_threshold` |
| `FloodPremiumWaitError` | `telethon.errors.rpcerrorlist` | `FloodError` (420) | **`.seconds`**; download throttle for non-Premium accounts. Docs say it *"must be automatically repeated by the client after X seconds"* — sleep-and-retry inline, **never** exponential-backoff or abort |
| `SlowModeWaitError` | `telethon.errors.rpcerrorlist` | `FloodError` (420) | `.seconds`; chat-specific, not cached per-request |
| `TakeoutInitDelayError` | `telethon.errors.rpcerrorlist` | `FloodError` (420) | `.seconds` |
| `ChannelPrivateError` | `telethon.errors.rpcerrorlist` | `BadRequestError` (400) | not a member / banned / channel deleted — **skip the chat, never retry** |
| `ChannelInvalidError` | `telethon.errors.rpcerrorlist` | `BadRequestError` (400) | bad `InputChannel`; re-resolve the entity |
| `ChatAdminRequiredError` | `telethon.errors.rpcerrorlist` | `BadRequestError` (400) | e.g. participants of a group you don't admin |
| `AuthKeyUnregisteredError` | `telethon.errors.rpcerrorlist` | `UnauthorizedError` (401) | **session dead** — user logged this session out. Purge the stored string, force re-login |
| `SessionRevokedError`, `SessionExpiredError` | `telethon.errors.rpcerrorlist` | `UnauthorizedError` (401) | same treatment |
| `UserDeactivatedError` | `telethon.errors.rpcerrorlist` | `UnauthorizedError` (401) | account self-deleted |
| `UserDeactivatedBanError` | `telethon.errors.rpcerrorlist` | `UnauthorizedError` (401) | **account banned** — stop, do not retry, do not re-login |
| `AuthKeyDuplicatedError` | `telethon.errors.rpcerrorlist` | `AuthKeyError` (406) | **destroys the session** — emitted when a non-media DC sees one authorized session issuing requests over two TCP connections. Same string used twice (§3), or exceeding `tmp_sessions` on the home DC (§7). User must re-login |
| `RpcCallFailError` | `telethon.errors.rpcerrorlist` | `ServerError` (500) | Telethon already retries `request_retries=5` times with `asyncio.sleep(2)` |
| `TimedOutError` | `telethon.errors.rpcbaseerrors` | `RPCError` (-503) | also auto-retried by `_call` |
| `telethon.errors.TimeoutError` | `telethon.errors.rpcerrorlist` | `TimedOutError` | ⚠ see shadowing note below |
| `FileReferenceExpiredError` | `telethon.errors.rpcerrorlist` | `BadRequestError` (400) | §10.1 |
| `FilerefUpgradeNeededError` | `telethon.errors.rpcerrorlist` | `AuthKeyError` (406) | same fix as above |
| `FileMigrateError` | `telethon.errors.rpcerrorlist` | `InvalidDCError` (303) | `.new_dc`; handled internally by the download iterator |
| `MsgIdInvalidError` | `telethon.errors.rpcerrorlist` | `BadRequestError` (400) | bad message id in the request; also seen on clock skew — **sync the system clock** |
| `MessageIdsEmptyError` | `telethon.errors.rpcerrorlist` | `BadRequestError` (400) | swallowed by `_IDsIter` |
| `PeerIdInvalidError` | `telethon.errors.rpcerrorlist` | `BadRequestError` (400) | e.g. `reply_to=` on a non-channel |
| `LocationInvalidError` | `telethon.errors.rpcerrorlist` | `BadRequestError` (400) | profile photo edge case, handled internally |
| `ApiIdInvalidError` | `telethon.errors.rpcerrorlist` | `BadRequestError` (400) | wrong `api_id`/`api_hash` pair |

⚠ **`telethon.errors.TimeoutError` shadows the builtin.** `rpcerrorlist.py` defines a class named
`TimeoutError` **twice** (line 4116 as `ServerError`, line 4233 as `TimedOutError`; the second wins), and
`telethon/errors/__init__.py` does `from .rpcerrorlist import *`. So
`from telethon.errors import *` silently replaces Python's `TimeoutError` in your namespace, and
`except TimeoutError:` may then not catch `asyncio.TimeoutError`. **Always `from telethon import errors` and
write `errors.TimeoutError`; use `asyncio.TimeoutError` explicitly for `qr.wait()`.**

### 10.1 The file-reference expiry problem — the big one for long exports

**What it is.** Every downloadable media carries a `file_reference: bytes` field
(`types.Document(id, access_hash, file_reference, ...)`, `types.Photo(id, access_hash, file_reference, ...)`).
Telegram issues it *with the message* and expires it server-side. It is **not** the file id — `id` and
`access_hash` stay valid forever; only the reference rots.

**Lifetime: undocumented.** Canonical page is https://core.telegram.org/api/file-references (note the
hyphen; `/api/file_reference` is a redirect stub) and it says only: *"A file reference may **expire**, in
which case it cannot be used in outgoing constructors: it must be refreshed by refetching the message, story,
etc where the media last appeared."* ⚠ Do **not** trust the "valid for at least 1 hour" figure search results
surface — that is the **Bot API** `getFile` download *link*, an entirely different mechanism. The best
available estimate for MTProto is Telethon's own FAQ: *"The `file_reference` is random for everyone and will
only work for a few hours before it expires."*

**How it bites an exporter.** You enumerate 200 000 messages into a queue, then download for six hours. Every
`Document` object you cached at minute 0 is stale by minute 90, and `upload.getFile` starts raising
`FileReferenceExpiredError` (or `FilerefUpgradeNeededError`).

**The only correct fix: re-fetch the *message* and take the fresh reference from it.** You cannot refresh a
reference in isolation.

```python
from telethon import errors

async def download_with_refresh(client, chat, msg_id, path, attempts=3):
    msg = await client.get_messages(chat, ids=msg_id)
    for _ in range(attempts):
        if msg is None:
            return None                       # deleted
        try:
            return await msg.download_media(file=path)   # pass the MESSAGE, not msg.media
        except (errors.FileReferenceExpiredError, errors.FilerefUpgradeNeededError):
            msg = await client.get_messages(chat, ids=msg_id)   # fresh file_reference
    raise RuntimeError(f'file reference kept expiring for {chat}/{msg_id}')
```

**Telethon does half of this for you — know the exact limits** (`downloads.py:118-139`). When you call
`client.download_media(message)` or `message.download_media()` with a real `Message`, Telethon stores
`msg_data = (message.input_chat, message.id)` and, on `FileReferenceExpiredError` mid-download, re-fetches
the message and patches `request.location.file_reference` in place. But it **bails out and re-raises** if:

* `msg_data` is `None` — i.e. you passed `message.media` / a raw `Document` instead of the `Message`, **or**
  `message.input_chat` was `None`;
* the location is not an `InputDocumentFileLocation` — **photos are not covered**, only documents
  (source comment: *"Only implemented for documents"*);
* `thumb_size != ''` — **thumbnail downloads are not covered**;
* the re-fetched message's media is no longer a `MessageMediaDocument`, or `document.id` changed (message
  edited).

So: **always pass the `Message` object**, and still wrap photo and thumbnail downloads in your own retry.

**Telegram's own documented procedure** is the "file source table": keep a map from file id → the
context(s) the file appeared in (`fileSourceMessage`, `fileSourceStory`, `fileSourceWebPage`,
`fileSourceUserProfilePhoto`, `fileSourceStickerSet`, `fileSourceSavedGifs`, `fileSourceWallPaper`,
`fileSourceChannelFull` / `fileSourceChatFull`). On `FILE_REFERENCE_EXPIRED` / `FILE_REFERENCE_INVALID`
(or `FILE_REFERENCE_%d_EXPIRED` from multi-media methods like `messages.sendMultiMedia`), look up the
source, run its refresh action, patch the constructor, resend. For an exporter, "source = the message" is
almost always sufficient — which is what the snippet above does.

**Design rules that make the problem mostly disappear:**
1. Persist message **ids**, not serialized `Document`/`Photo` objects. Re-fetch with
   `client.get_messages(chat, ids=[...])` (up to 100 per call) right before downloading.
2. Keep the enumerate→download gap short: interleave, or work in windows of a few thousand ids.
3. Key your dedupe/cache on `document.id`, which never expires (§7).
4. References can expire **mid-download** of a very large file (Telethon #4341) — resume from the byte
   offset with a refreshed reference rather than restarting from zero.

### 10.2 A resilience wrapper worth having

```python
import asyncio, random
from telethon import errors

FATAL = (errors.ChannelPrivateError, errors.ChatAdminRequiredError,
         errors.AuthKeyUnregisteredError, errors.UserDeactivatedError,
         errors.UserDeactivatedBanError, errors.SessionRevokedError)

async def resilient(coro_factory, *, tries=5, max_flood=3600):
    for attempt in range(tries):
        try:
            return await coro_factory()
        except (errors.FloodWaitError, errors.FloodPremiumWaitError,
                errors.SlowModeWaitError) as e:
            if e.seconds > max_flood:
                raise
            await asyncio.sleep(e.seconds + 2)
        except FATAL:
            raise                                        # never retry these
        except (errors.RpcCallFailError, errors.TimedOutError, ConnectionError, OSError):
            await asyncio.sleep(2 ** attempt + random.random())
    raise RuntimeError('exhausted retries')
```

Note `coro_factory` (a callable), not a coroutine object — a coroutine cannot be awaited twice.

---

## 11. `api_id` / `api_hash`

**Both "per-account" and "per-application" are true, in different senses — this is the usual confusion:**

* **Issuance is per phone number.** https://core.telegram.org/api/obtaining_api_id: *"For the moment each
  number can only have one api_id connected to it."* You get the pair at
  **https://my.telegram.org → API development tools**.
* **Usage is per application.** Telethon's docs: *"This API ID and hash is the one used by your application,
  not your phone number. You can use this API ID and hash with **any** phone number or even for bot
  accounts."*

**So yes — one `api_id` can serve many accounts, and that is the intended design.** Telegram Desktop ships a
single pair serving tens of millions of accounts. Nothing in the protocol or in Telethon ties an `api_id` to
a user; `TelegramClient(session, api_id, api_hash)` reuses the same pair per session.

Caveats that matter in production:

* The pair is a **secret**. Ship it server-side, never in a client bundle.
* ⚠ **`ApiIdPublishedFloodError` is about *published* api_ids, not account count.** It targets credentials
  that appear in public sample code (notably Telegram's own examples), which are permanently server-throttled.
  In the worst documented case, accounts using hardcoded TDLib example credentials were **banned within
  seconds**. Never reuse an api_id found in a repo or tutorial — register your own.
* ⚠ **No credible evidence exists of api_id bans purely for multi-account reuse.** Such claims come only from
  spam-tooling vendor blogs and blackhat forums. Official risk attaches to *behaviour*, not account count:
  Telegram states that *"all accounts that log in using unofficial Telegram API clients are automatically put
  under observation"*, and flooding/spamming means a permanent ban.
* ToS (https://core.telegram.org/api/terms) requires only *"You must obtain your own api_id for your
  application."* ⚠ Note **§1.5 prohibits aggregating Telegram data to train AI/ML models** — relevant if the
  export feeds a model.
* ⚠ The `my.telegram.org` "ERROR" wall is **IP-reputation driven**, not a bug. Register from a
  residential/mobile-carrier IP in the same country as the account's phone number, with no VPN/proxy.
* `auth.sendCode` is rate-limited per phone (≈5 attempts/day) and per IP. **Register the api_id on the same
  number you test logins with — that number gets more generous flood limits** (§1.1).
* `device_model` / `system_version` / `app_version` are shown in the user's "Active Sessions". Set them to
  something identifiable; it reduces suspicious-session auto-logouts.

---

## 12. Multiple clients, one event loop; disconnect & reconnection

**Multiple `TelegramClient` instances in one asyncio loop is supported and normal** — one per account. Rules:

1. **One session per client, always.** Two clients on one `SQLiteSession` file →
   `sqlite3.OperationalError: database is locked` (Telethon FAQ: *"if you need two clients, use two
   sessions"*). Two clients on one auth key → `AuthKeyDuplicatedError` / silent disconnects.
2. **The loop is pinned at first `connect()`.** `self._loop = helpers.get_running_loop()` on first connect;
   any later call from a different loop raises
   `RuntimeError('The asyncio event loop must not change after connection (see the FAQ for details)')`
   (`telegrambaseclient.py:527`, `users.py:33`). Consequences:
   * Never `asyncio.run()` more than once around the same client.
   * Never create the client at import time in a thread whose loop later goes away.
   * Under FastAPI/uvicorn, create clients inside the lifespan/startup coroutine so they bind to uvicorn's
     loop, and never touch them from a `ThreadPoolExecutor` / a `def` (sync) endpoint.
   * Do **not** `import telethon.sync` in a server — it monkeypatches every coroutine method to block on the
     loop and will deadlock.
3. **Never share entity objects/sessions between clients.** `access_hash` values are per-account; an entity
   resolved by account A is meaningless to account B (`PeerIdInvalidError` / `ChannelInvalidError`).
4. `client.disconnect()` is **dual-mode**: it returns a coroutine when a loop is already running, and blocks
   otherwise (`telegrambaseclient.py:636`). Inside async code **always `await client.disconnect()`**. It also
   disconnects all borrowed per-DC senders, cancels the update/keepalive tasks, and cancels running event
   handlers — so calling it *from* an event handler will cancel the caller.
5. **Reconnection is automatic** (`auto_reconnect=True`, `connection_retries=5`, `retry_delay=1`). The
   `MTProtoSender` reconnects and replays pending requests; you generally should not write your own
   reconnect loop. `client.is_connected()` is **synchronous** (do not `await` it) and
   `client.disconnected` is a `Future` that resolves on disconnection — handy for a health check.
6. After `await client.log_out()` the object is dead: `self.session = None`, and `connect()` then raises
   `ValueError('TelegramClient instance cannot be reused after logging out')`. Build a new client.
7. `connect()` performs only the layer handshake. Telegram will not send updates until you make a real
   request; Telethon calls `get_me()` internally when the message box is empty. Use
   `await client.is_user_authorized()` (cheap, session-based) or `await client.get_me()` (an RPC) to verify a
   restored session is still alive — a revoked session surfaces as `AuthKeyUnregisteredError` on the first
   real request, not at connect time.
8. Graceful shutdown: keep clients in a registry and `await asyncio.gather(*(c.disconnect() for c in ...))`
   in the FastAPI shutdown hook, otherwise you get *"Task was destroyed but it is pending"*.
9. `client.loop` is **not** a stored attribute — it is `helpers.get_running_loop()`, i.e. the *currently
   running* loop. Do not use it to decide which loop the client belongs to.

---

## Appendix — quick import cheat sheet

```python
from telethon import TelegramClient, errors, utils, functions, types
from telethon.sessions import StringSession, SQLiteSession, MemorySession
from telethon.tl.custom.qrlogin  import QRLogin
from telethon.tl.custom.message  import Message
from telethon.tl.custom.dialog   import Dialog
from telethon.tl.custom.file     import File
from telethon.tl.custom.forward  import Forward
from telethon.tl.types import (
    Channel, Chat, User, Document, Photo,
    DocumentAttributeVideo, DocumentAttributeAudio, DocumentAttributeSticker,
    DocumentAttributeAnimated, DocumentAttributeFilename, DocumentAttributeCustomEmoji,
    MessageMediaDocument, MessageMediaPhoto, MessageMediaPoll, MessageMediaWebPage,
    MessageReactions, ReactionEmoji, ReactionCustomEmoji,
    InputMessagesFilterPhotos, InputMessagesFilterVideo, InputMessagesFilterPinned,
)
from telethon.tl.functions.channels import GetFullChannelRequest
from telethon.tl.functions.messages import GetFullChatRequest, GetStickerSetRequest
from telethon.tl.functions.users    import GetFullUserRequest
```
