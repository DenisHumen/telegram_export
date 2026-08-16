import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Phone,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  TriangleAlert,
} from 'lucide-react';
import { cn } from '../lib/cn';
import * as api from '../api/client';
import type { AuthState } from '../api/types';
import { qk } from '../hooks/queries';
import { AUTH_ERROR_HINT, codeTypeLabel } from '../lib/labels';
import { formatNumber } from '../lib/format';
import { toast, useUiStore } from '../store/ui';
import { CodeInput } from '../components/auth/CodeInput';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { CountdownRing } from '../components/ui/ProgressBar';
import { TextField } from '../components/ui/Field';
import { Badge } from '../components/ui/Badge';

type Step = 1 | 2 | 3 | 4 | 5;
type Method = 'qr' | 'phone';

const STEPS: { id: Step; label: string }[] = [
  { id: 1, label: 'Реквизиты' },
  { id: 2, label: 'Способ входа' },
  { id: 3, label: 'Вход' },
  { id: 4, label: '2FA' },
  { id: 5, label: 'Готово' },
];

function Stepper({ step }: { step: Step }) {
  return (
    <ol className="flex flex-wrap items-center gap-2">
      {STEPS.map((item, index) => {
        const done = step > item.id;
        const active = step === item.id;
        return (
          <li key={item.id} className="flex items-center gap-2">
            <span
              className={cn(
                'tnum flex h-6 w-6 items-center justify-center rounded-pill text-[11.5px] font-medium transition-colors duration-120',
                done
                  ? 'bg-success/15 text-success'
                  : active
                    ? 'bg-accent-soft text-accent'
                    : 'bg-surface-2 text-muted',
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : item.id}
            </span>
            <span className={cn('text-[12.5px]', active ? 'text-text' : 'text-muted')}>{item.label}</span>
            {index < STEPS.length - 1 ? <span className="mx-1 h-px w-5 bg-border-strong" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function formatPhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 15);
  if (!digits) return '';
  const parts = [digits.slice(0, 1), digits.slice(1, 4), digits.slice(4, 7), digits.slice(7, 9), digits.slice(9, 11)];
  return `+${parts.filter(Boolean).join(' ')}${digits.length > 11 ? ` ${digits.slice(11)}` : ''}`;
}

function AuthError({ state }: { state: AuthState | null }) {
  if (!state || (!state.error && !state.error_code)) return null;
  const hint = state.error_code ? AUTH_ERROR_HINT[state.error_code] : undefined;
  return (
    <div className="flex items-start gap-2.5 rounded-control border border-danger/30 px-3.5 py-3 text-[13px] text-danger">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="break-words">{state.error ?? hint ?? 'Ошибка авторизации'}</p>
        {state.error_code ? (
          <p className="mt-0.5 font-mono text-[11.5px] opacity-75">
            {state.error_code}
            {hint && state.error ? ` — ${hint}` : ''}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function AddAccountWizard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setActiveAccountId = useUiStore((state) => state.setActiveAccountId);

  const [step, setStep] = useState<Step>(1);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [method, setMethod] = useState<Method>('qr');

  const [label, setLabel] = useState('');
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [floodUntil, setFloodUntil] = useState<number | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const authQuery = useQuery({
    queryKey: qk.authState(accountId ?? 0),
    queryFn: () => (method === 'qr' ? api.authQrStatus(accountId as number) : api.getAuthState(accountId as number)),
    enabled: accountId !== null && step >= 3 && step <= 4,
    refetchInterval: method === 'qr' && step === 3 ? 2000 : false,
    retry: false,
  });
  const auth = authQuery.data ?? null;

  const setAuth = useCallback(
    (state: AuthState) => {
      if (accountId === null) return;
      queryClient.setQueryData(qk.authState(accountId), state);
    },
    [accountId, queryClient],
  );

  /* ---------------------------------------------------------- mutations */

  const createAccountMutation = useMutation({
    mutationFn: () => api.createAccount({ label: label.trim(), api_id: Number(apiId), api_hash: apiHash.trim() }),
    onSuccess: (account) => {
      setAccountId(account.id);
      setActiveAccountId(account.id);
      void queryClient.invalidateQueries({ queryKey: qk.accounts });
      toast.success('Аккаунт создан', account.label);
      setStep(2);
    },
    onError: (error) => toast.error('Не удалось создать аккаунт', api.errorMessage(error)),
  });

  const qrStartMutation = useMutation({
    mutationFn: () => api.authQrStart(accountId as number),
    onSuccess: setAuth,
    onError: (error) => toast.error('Не удалось получить QR-код', api.errorMessage(error)),
  });

  const qrRefreshMutation = useMutation({
    mutationFn: () => api.authQrRefresh(accountId as number),
    onSuccess: setAuth,
    onError: (error) => toast.error('Не удалось обновить QR-код', api.errorMessage(error)),
  });

  const sendCodeMutation = useMutation({
    mutationFn: () => api.authSendCode(accountId as number, `+${phone.replace(/\D/g, '')}`),
    onSuccess: (state) => {
      setAuth(state);
      if (state.status === 'code_sent') toast.success(codeTypeLabel(state.code_type));
    },
    onError: (error) => toast.error('Не удалось отправить код', api.errorMessage(error)),
  });

  const signInMutation = useMutation({
    mutationFn: () => api.authSignIn(accountId as number, code),
    onSuccess: (state) => {
      setAuth(state);
      if (state.status === 'error') setCode('');
    },
    onError: (error) => {
      setCode('');
      toast.error('Не удалось войти', api.errorMessage(error));
    },
  });

  const passwordMutation = useMutation({
    mutationFn: () => api.authPassword(accountId as number, password),
    onSuccess: (state) => {
      setAuth(state);
      if (state.status !== 'authorized') setPassword('');
    },
    onError: (error) => toast.error('Не удалось проверить пароль', api.errorMessage(error)),
  });

  const cancelAuthMutation = useMutation({
    mutationFn: () => api.authCancel(accountId as number),
    onSuccess: setAuth,
  });

  const syncMutation = useMutation({
    mutationFn: () => api.syncChats(accountId as number, {}),
    onSuccess: (result) => {
      toast.success('Чаты синхронизированы', `Получено ${formatNumber(result.synced)}`);
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
      navigate(`/accounts/${accountId}/chats`);
    },
    onError: (error) => toast.error('Не удалось синхронизировать чаты', api.errorMessage(error)),
  });

  /* ------------------------------------------------------------ effects */

  const status = auth?.status;

  useEffect(() => {
    if (!status) return;
    if (status === 'password_required') setStep((current) => (current === 5 ? current : 4));
    else if (status === 'authorized') setStep(5);
  }, [status]);

  useEffect(() => {
    if (auth?.error_code === 'FLOOD_WAIT' && auth.retry_after) {
      setFloodUntil(Date.now() + auth.retry_after * 1000);
    }
  }, [auth?.error_code, auth?.retry_after]);

  const qrExpiresAt = auth?.qr_expires_at ? new Date(auth.qr_expires_at).getTime() : null;
  const qrRemaining = qrExpiresAt ? Math.max(0, Math.ceil((qrExpiresAt - now) / 1000)) : 0;
  const qrTotal = 60;

  const autoRefreshRef = useRef(false);
  useEffect(() => {
    if (method !== 'qr' || step !== 3 || accountId === null) return;
    const expired = status === 'qr_expired' || (status === 'qr_waiting' && qrExpiresAt !== null && qrRemaining <= 0);
    if (!expired || autoRefreshRef.current || qrRefreshMutation.isPending) return;
    autoRefreshRef.current = true;
    qrRefreshMutation.mutate(undefined, {
      onSettled: () => {
        window.setTimeout(() => {
          autoRefreshRef.current = false;
        }, 1500);
      },
    });
  }, [method, step, accountId, status, qrRemaining, qrExpiresAt, qrRefreshMutation]);

  const floodRemaining = floodUntil ? Math.max(0, Math.ceil((floodUntil - now) / 1000)) : 0;
  const canCreate = label.trim().length > 0 && /^\d{4,10}$/.test(apiId.trim()) && apiHash.trim().length >= 16;

  const goToMethod = (next: Method) => {
    setMethod(next);
    setStep(3);
    if (next === 'qr' && accountId !== null) qrStartMutation.mutate();
  };

  const chatsPath = useMemo(() => (accountId !== null ? `/accounts/${accountId}/chats` : '/accounts'), [accountId]);

  /** Abort the current login attempt and go back to the method picker. */
  const backToMethods = () => {
    if (accountId !== null) cancelAuthMutation.mutate();
    setCode('');
    setStep(2);
  };

  /* -------------------------------------------------------------- render */

  return (
    <div className="mx-auto max-w-[940px] space-y-6">
      <PageHeader title="Новый аккаунт" subtitle="Подключение Telegram-аккаунта для выгрузки архива">
        <Link to="/accounts">
          <Button variant="ghost" size="sm" icon={<ArrowLeft className="h-3.5 w-3.5" />}>
            К аккаунтам
          </Button>
        </Link>
      </PageHeader>

      <Stepper step={step} />

      {/* ------------------------------------------------ step 1 */}
      {step === 1 ? (
        <div className="grid gap-8 border-t border-border pt-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section>
            <h2 className="text-[13px] font-medium text-dim">Реквизиты приложения</h2>
            <p className="mt-1 max-w-lg text-[13px] leading-relaxed text-muted">
              Эти данные нужны Telegram, чтобы отличать клиентские приложения. Они хранятся только локально.
            </p>
            <form
              className="mt-5 max-w-lg space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (canCreate) createAccountMutation.mutate();
              }}
            >
              <TextField
                label="Название аккаунта"
                placeholder="Личный, Рабочий, Архив…"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                hint="Произвольное имя, видно только вам"
                autoFocus
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label="api_id"
                  mono
                  inputMode="numeric"
                  placeholder="1234567"
                  value={apiId}
                  onChange={(event) => setApiId(event.target.value.replace(/\D/g, ''))}
                />
                <TextField
                  label="api_hash"
                  mono
                  placeholder="0123456789abcdef0123456789abcdef"
                  value={apiHash}
                  onChange={(event) => setApiHash(event.target.value.trim())}
                />
              </div>
              <Button
                type="submit"
                variant="primary"
                disabled={!canCreate}
                loading={createAccountMutation.isPending}
                icon={<ArrowRight className="h-4 w-4" />}
              >
                Создать и продолжить
              </Button>
            </form>
          </section>

          <aside className="h-fit rounded-card border border-border p-5">
            <h3 className="text-[13px] font-medium text-text">Где взять api_id и api_hash</h3>
            <ol className="mt-3 space-y-2.5 text-[13px] leading-relaxed text-dim">
              {[
                <>
                  Откройте{' '}
                  <a
                    href="https://my.telegram.org"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-accent underline-offset-4 hover:underline"
                  >
                    my.telegram.org <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>{' '}
                  и войдите по номеру телефона.
                </>,
                <>Перейдите в раздел «API development tools».</>,
                <>Заполните название и укажите платформу (например, Desktop).</>,
                <>
                  Скопируйте <span className="font-mono text-text">App api_id</span> и{' '}
                  <span className="font-mono text-text">App api_hash</span>.
                </>,
              ].map((content, index) => (
                <li key={index} className="flex gap-2.5">
                  <span className="tnum font-mono text-muted">{index + 1}.</span>
                  <span>{content}</span>
                </li>
              ))}
            </ol>
            <p className="mt-4 border-t border-border pt-3 text-[12.5px] leading-relaxed text-muted">
              Одну пару <span className="font-mono">api_id</span> / <span className="font-mono">api_hash</span> можно
              использовать сразу для нескольких аккаунтов.
            </p>
          </aside>
        </div>
      ) : null}

      {/* ------------------------------------------------ step 2 */}
      {step === 2 ? (
        <div className="space-y-4 border-t border-border pt-6">
          <p className="text-[13px] text-dim">Выберите способ входа в Telegram</p>
          <div className="grid gap-4 md:grid-cols-2">
            <button
              type="button"
              onClick={() => goToMethod('qr')}
              className="card card-hover group p-5 text-left"
            >
              <div className="flex items-start justify-between">
                <QrCode className="h-6 w-6 text-accent" aria-hidden />
                <Badge tone="success">рекомендуется</Badge>
              </div>
              <h3 className="mt-4 text-[15px] font-medium text-text">QR-код</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-dim">
                Отсканируйте код в приложении Telegram на телефоне. Быстро и без ввода SMS-кода.
              </p>
              <span className="mt-4 inline-flex items-center gap-1.5 text-[13px] text-accent">
                Показать QR
                <ArrowRight className="h-4 w-4 transition-transform duration-120 group-hover:translate-x-0.5" />
              </span>
            </button>

            <button
              type="button"
              onClick={() => goToMethod('phone')}
              className="card card-hover group p-5 text-left"
            >
              <Phone className="h-6 w-6 text-dim" aria-hidden />
              <h3 className="mt-4 text-[15px] font-medium text-text">Номер телефона</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-dim">
                Telegram пришлёт код подтверждения в приложение или по SMS.
              </p>
              <span className="mt-4 inline-flex items-center gap-1.5 text-[13px] text-dim">
                Ввести номер
                <ArrowRight className="h-4 w-4 transition-transform duration-120 group-hover:translate-x-0.5" />
              </span>
            </button>
          </div>
        </div>
      ) : null}

      {/* ------------------------------------------------ step 3: QR */}
      {step === 3 && method === 'qr' ? (
        <div className="grid gap-8 border-t border-border pt-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          <section className="flex flex-col items-center">
            {/* The QR itself stays black-on-white in both themes — scanners need the contrast. */}
            <div className="relative rounded-card border border-border bg-white p-4">
              {auth?.qr_url ? (
                <QRCodeSVG value={auth.qr_url} size={220} level="M" bgColor="#FFFFFF" fgColor="#1F1E1D" />
              ) : (
                <div className="flex h-[220px] w-[220px] items-center justify-center">
                  <RefreshCw className="h-6 w-6 animate-spin text-muted" aria-hidden />
                </div>
              )}
              {status === 'qr_expired' || (qrExpiresAt !== null && qrRemaining <= 0) ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-card bg-surface/95">
                  <p className="text-[13px] text-text">QR-код истёк</p>
                  <Button
                    size="sm"
                    variant="primary"
                    loading={qrRefreshMutation.isPending}
                    onClick={() => qrRefreshMutation.mutate()}
                  >
                    Обновить
                  </Button>
                </div>
              ) : null}
            </div>

            <div className="mt-4 flex items-center gap-3">
              <CountdownRing remaining={qrRemaining} total={qrTotal}>
                {qrRemaining}
              </CountdownRing>
              <div className="text-[12.5px] text-dim">
                <p className="tnum">Код действителен ещё {qrRemaining} с</p>
                <p className="text-muted">Обновится автоматически</p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-[13px] font-medium text-dim">Как войти по QR-коду</h2>
            <ol className="mt-3 space-y-2.5 text-[13px] leading-relaxed text-dim">
              {[
                'Откройте Telegram на телефоне',
                'Перейдите в «Настройки» (Settings)',
                'Выберите «Устройства» (Devices)',
                'Нажмите «Подключить устройство» (Link Desktop Device)',
                'Наведите камеру на QR-код слева',
              ].map((text, index) => (
                <li key={text} className="flex items-start gap-2.5">
                  <span className="tnum font-mono text-[11.5px] text-muted">{index + 1}.</span>
                  <span>{text}</span>
                </li>
              ))}
            </ol>

            <p className="mt-5 flex items-start gap-2.5 border-t border-border pt-4 text-[12.5px] leading-relaxed text-muted">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-dim" aria-hidden />
              Если на аккаунте включён облачный пароль (2FA), после сканирования появится шаг ввода пароля — это
              нормальное поведение Telegram.
            </p>

            <div className="mt-5 space-y-3">
              <AuthError state={auth} />
              <div className="flex items-center gap-2 text-[12.5px] text-muted">
                <span className="h-1.5 w-1.5 animate-soft-pulse rounded-pill bg-accent" />
                Ожидаем сканирование…
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  icon={<ArrowLeft className="h-4 w-4" />}
                  loading={cancelAuthMutation.isPending}
                  onClick={backToMethods}
                >
                  Другой способ
                </Button>
                <Button
                  variant="secondary"
                  icon={<RefreshCw className="h-3.5 w-3.5" />}
                  loading={qrRefreshMutation.isPending}
                  onClick={() => qrRefreshMutation.mutate()}
                >
                  Обновить QR
                </Button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {/* ------------------------------------------------ step 3: phone */}
      {step === 3 && method === 'phone' ? (
        <div className="grid gap-8 border-t border-border pt-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <section className="max-w-lg">
            <h2 className="text-[13px] font-medium text-dim">Вход по номеру телефона</h2>

            <form
              className="mt-4 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (floodRemaining === 0) sendCodeMutation.mutate();
              }}
            >
              <TextField
                label="Номер телефона"
                mono
                inputMode="tel"
                placeholder="+7 999 123 45 67"
                value={phone}
                onChange={(event) => setPhone(formatPhoneInput(event.target.value))}
                leading={<Smartphone className="h-4 w-4" />}
                disabled={status === 'code_sent'}
                hint="В международном формате, с кодом страны"
              />
              {status !== 'code_sent' ? (
                <Button
                  type="submit"
                  variant="primary"
                  disabled={phone.replace(/\D/g, '').length < 8 || floodRemaining > 0}
                  loading={sendCodeMutation.isPending}
                >
                  {floodRemaining > 0 ? `Подождите ${floodRemaining} с` : 'Получить код'}
                </Button>
              ) : null}
            </form>

            {status === 'code_sent' ? (
              <div className="mt-6 space-y-4 border-t border-border pt-5">
                <div>
                  <p className="label">Код подтверждения</p>
                  <p className="mb-3 text-[13px] text-dim">{codeTypeLabel(auth?.code_type ?? null)}</p>
                  <CodeInput
                    value={code}
                    onChange={setCode}
                    autoFocus
                    invalid={auth?.error_code === 'PHONE_CODE_INVALID'}
                    disabled={signInMutation.isPending || floodRemaining > 0}
                    onComplete={() => {
                      if (floodRemaining === 0) signInMutation.mutate();
                    }}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="primary"
                    disabled={code.length < 5 || floodRemaining > 0}
                    loading={signInMutation.isPending}
                    onClick={() => signInMutation.mutate()}
                  >
                    {floodRemaining > 0 ? `Подождите ${floodRemaining} с` : 'Войти'}
                  </Button>
                  <Button
                    variant="ghost"
                    icon={<RefreshCw className="h-4 w-4" />}
                    loading={sendCodeMutation.isPending}
                    disabled={floodRemaining > 0}
                    onClick={() => {
                      setCode('');
                      sendCodeMutation.mutate();
                    }}
                  >
                    Отправить код заново
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="mt-5 space-y-3">
              <AuthError state={auth} />
              {floodRemaining > 0 ? (
                <div className="flex items-center gap-2.5 rounded-control border border-warning/30 px-3.5 py-3 text-[13px] text-warning">
                  <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
                  Telegram ограничил попытки входа. Повторить можно через{' '}
                  <span className="tnum font-mono">{floodRemaining}</span> с.
                </div>
              ) : null}
              <Button
                variant="ghost"
                icon={<ArrowLeft className="h-4 w-4" />}
                loading={cancelAuthMutation.isPending}
                onClick={backToMethods}
              >
                Другой способ
              </Button>
            </div>
          </section>

          <aside className="h-fit rounded-card border border-border p-5">
            <h3 className="text-[13px] font-medium text-text">Подсказки</h3>
            <ul className="mt-3 space-y-2.5 text-[13px] leading-relaxed text-dim">
              <li>Код приходит в само приложение Telegram, если вы уже авторизованы на другом устройстве.</li>
              <li>Если приложений нет — Telegram отправит SMS.</li>
              <li>Код можно вставить целиком из буфера обмена — поля заполнятся автоматически.</li>
              <li>При включённом 2FA после кода потребуется облачный пароль.</li>
            </ul>
          </aside>
        </div>
      ) : null}

      {/* ------------------------------------------------ step 4: 2FA */}
      {step === 4 ? (
        <div className="mx-auto max-w-[520px] border-t border-border pt-6">
          <div className="flex items-center gap-3">
            <KeyRound className="h-5 w-5 text-accent" aria-hidden />
            <div>
              <h2 className="text-[14px] font-medium text-text">Облачный пароль (2FA)</h2>
              <p className="text-[12.5px] text-muted">На аккаунте включена двухфакторная защита</p>
            </div>
          </div>

          <form
            className="mt-5 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (password && floodRemaining === 0) passwordMutation.mutate();
            }}
          >
            <TextField
              label="Пароль"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoFocus
              autoComplete="current-password"
              hint={
                auth?.password_hint
                  ? `Подсказка: ${auth.password_hint}`
                  : 'Тот самый пароль, который вы задали в настройках Telegram'
              }
              trailing={
                <button
                  type="button"
                  aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                  onClick={() => setShowPassword((value) => !value)}
                  className="rounded-[8px] p-1.5 text-muted transition-colors duration-120 hover:bg-veil hover:text-text"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              }
            />
            <AuthError state={auth} />
            {floodRemaining > 0 ? (
              <div className="flex items-center gap-2.5 rounded-control border border-warning/30 px-3.5 py-3 text-[13px] text-warning">
                <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
                Повторить можно через <span className="tnum font-mono">{floodRemaining}</span> с.
              </div>
            ) : null}
            <Button
              type="submit"
              variant="primary"
              fullWidth
              disabled={!password || floodRemaining > 0}
              loading={passwordMutation.isPending}
            >
              {floodRemaining > 0 ? `Подождите ${floodRemaining} с` : 'Подтвердить'}
            </Button>
          </form>
        </div>
      ) : null}

      {/* ------------------------------------------------ step 5 */}
      {step === 5 ? (
        <div className="mx-auto max-w-[520px] border-t border-border pt-8 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-pill bg-success/15 text-success">
            <Check className="h-6 w-6" aria-hidden />
          </span>
          <h2 className="mt-4 text-[17px] font-semibold tracking-[-0.01em] text-text">Аккаунт подключён</h2>
          <p className="mt-1.5 text-[13px] text-dim">
            {auth?.user
              ? `${[auth.user.first_name, auth.user.last_name].filter(Boolean).join(' ') || 'Пользователь'}${
                  auth.user.username ? ` · @${auth.user.username}` : ''
                }`
              : 'Авторизация завершена'}
          </p>
          {auth?.user?.phone ? <p className="tnum mt-1 font-mono text-[12.5px] text-muted">{auth.user.phone}</p> : null}
          {auth?.user?.is_premium ? (
            <div className="mt-2 flex justify-center">
              <Badge tone="warning">Telegram Premium</Badge>
            </div>
          ) : null}

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button
              variant="primary"
              loading={syncMutation.isPending}
              icon={<RefreshCw className="h-4 w-4" />}
              onClick={() => syncMutation.mutate()}
            >
              Синхронизировать чаты
            </Button>
            <Link to={chatsPath}>
              <Button variant="secondary" fullWidth>
                Перейти к чатам
              </Button>
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
