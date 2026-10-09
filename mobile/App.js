import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import api from './src/api';

const TOKEN_KEY = 'saldo_slim_token';
const ONBOARDING_KEY = 'saldo_slim_onboarding_v1';
const WEB_ACCOUNT = 'https://saldo-slim.onrender.com/account.html';
const INSTALL_URL = 'https://saldo-slim.onrender.com/installeren.html';
const PADDLE_URL = 'https://vendors.paddle.com/';
const SUPPORT_EMAIL = 'info@partydj-dylan.nl';
const OWNER_EMAIL = 'dbijl97@outlook.com';

const C = {
  navy: '#163A5F',
  green: '#2F7D5B',
  amber: '#E3A323',
  red: '#B64242',
  bg: '#F5F7F8',
  white: '#FFFFFF',
  ink: '#203040',
  muted: '#617181',
  line: '#DCE3E8',
};

const ONBOARDING_SLIDES = [
  {
    title: 'Overzicht',
    text: 'Zet je inkomen, vaste lasten en reserveringen overzichtelijk bij elkaar. Zo zie je wat er overblijft.',
    mark: '1',
  },
  {
    title: 'Veilig dagbedrag',
    text: 'Saldo Slim deelt je beschikbare ruimte door het aantal dagen. Zo weet je wat je vandaag veilig kunt besteden.',
    mark: '2',
  },
  {
    title: 'Plannen stap voor stap',
    text: 'Vul je bedragen in, kies hoeveel dagen je wilt plannen en bekijk daarna een helder resultaat.',
    mark: '3',
  },
  {
    title: 'Privacy & abonnementen',
    text: 'Beheer betaalde abonnementen via onze website en Paddle. Google Play-betalingen zijn uitgeschakeld.',
    mark: '4',
  },
];

function getRole(data) {
  return String(data?.user?.role || data?.role || data?.me?.role || '').toLowerCase();
}

function getArray(data, key) {
  const source = data?.[key] ?? data?.data?.[key] ?? data?.items ?? data?.data;
  return Array.isArray(source) ? source : [];
}

function itemId(item) {
  return item?.id ?? item?._id ?? item?.userId ?? item?.subscriptionId ?? item?.ticketId;
}

function parseAmount(value) {
  const parsed = Number(String(value ?? '').trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value) {
  return `€ ${Number(value || 0).toFixed(2).replace('.', ',')}`;
}

function errorCode(error) {
  return String(
    error?.code ||
      error?.response?.data?.code ||
      error?.response?.code ||
      '',
  ).toLowerCase();
}

function isUnauthorized(error) {
  return (
    Number(error?.status || error?.statusCode || error?.response?.status) === 401 ||
    errorCode(error) === 'unauthorized'
  );
}

function errorMessage(error, fallback) {
  if (errorCode(error) === 'email_provider_not_configured') {
    return 'E-mailprovider moet nog worden ingesteld';
  }
  return error?.message || fallback;
}

function BrandMark({ small = false }) {
  return (
    <View style={[styles.brandMark, small && styles.brandMarkSmall]}>
      <Text style={[styles.brandMarkText, small && styles.brandMarkTextSmall]}>S</Text>
    </View>
  );
}

function Button({ title, onPress, variant = 'primary', disabled = false, accessibilityLabel }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        variant === 'quiet' && styles.buttonQuiet,
        disabled && styles.disabled,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          (variant === 'secondary' || variant === 'quiet') && styles.secondaryText,
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

function Field({
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
  multiline,
  autoCapitalize,
  accessibilityLabel,
}) {
  return (
    <TextInput
      accessibilityLabel={accessibilityLabel || placeholder}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={C.muted}
      secureTextEntry={secureTextEntry}
      keyboardType={keyboardType}
      multiline={multiline}
      autoCapitalize={
        autoCapitalize || (keyboardType === 'email-address' ? 'none' : 'sentences')
      }
      autoCorrect={keyboardType !== 'email-address'}
      style={[styles.input, multiline && styles.multiline]}
    />
  );
}

function Card({ title, children, style }) {
  return (
    <View style={[styles.card, style]}>
      {title ? <Text style={styles.cardTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

function Label({ children }) {
  return <Text style={styles.label}>{children}</Text>;
}

function Tab({ title, selected, onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.tab, selected && styles.tabSelected]}
    >
      <Text style={[styles.tabText, selected && styles.tabTextSelected]}>{title}</Text>
    </Pressable>
  );
}

function Notice({ text, onPress, onInstall }) {
  if (!text) return null;
  return (
    <View style={styles.notice}>
      <Text style={styles.noticeText}>{text}</Text>
      {text === 'E-mailprovider moet nog worden ingesteld' ? (
        <Button
          title="Installatie-informatie openen"
          variant="secondary"
          onPress={onInstall}
        />
      ) : null}
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Melding sluiten"
          onPress={onPress}
          style={styles.noticeClose}
        >
          <Text style={styles.noticeCloseText}>Sluiten</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Metric({ label, value }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel} numberOfLines={2}>
        {label}
      </Text>
      <Text style={styles.metricValue} numberOfLines={2}>
        {String(value)}
      </Text>
    </View>
  );
}

function compactMetrics(data) {
  const source = data?.data && !Array.isArray(data.data) ? data.data : data;
  if (!source || typeof source !== 'object') return [];
  const preferred = [
    'users',
    'totalUsers',
    'activeUsers',
    'subscriptions',
    'activeSubscriptions',
    'revenue',
    'payouts',
    'openSupport',
    'supportTickets',
  ];
  const labels = {
    users: 'Gebruikers',
    totalUsers: 'Totaal gebruikers',
    activeUsers: 'Actieve gebruikers',
    subscriptions: 'Abonnementen',
    activeSubscriptions: 'Actieve abonnementen',
    revenue: 'Omzet',
    payouts: 'Uitbetalingen',
    openSupport: 'Open support',
    supportTickets: 'Supportverzoeken',
  };
  const entries = [];
  preferred.forEach((key) => {
    if (source[key] !== undefined && source[key] !== null && typeof source[key] !== 'object') {
      entries.push([labels[key] || key, source[key]]);
    }
  });
  if (entries.length) return entries.slice(0, 6);

  return Object.entries(source)
    .filter(([, value]) => value === null || ['string', 'number', 'boolean'].includes(typeof value))
    .slice(0, 6)
    .map(([key, value]) => [
      key.replace(/([A-Z])/g, ' $1').replace(/[_-]/g, ' '),
      value === null ? '—' : value,
    ]);
}

function AdminUser({ item, isOwner, disabled, onRole, onStatus }) {
  const id = itemId(item);
  const currentRole = String(item?.role || 'user').toLowerCase();
  const currentStatus = String(item?.status || 'active').toLowerCase();

  return (
    <View style={styles.adminRow}>
      <Text style={styles.rowTitle}>
        {item?.name || item?.email || `Gebruiker ${id ?? ''}`}
      </Text>
      <Text style={styles.muted}>
        {item?.email && item?.name ? `${item.email} · ` : ''}
        Rol: {currentRole} · Status: {currentStatus}
      </Text>
      {isOwner && id != null ? (
        <>
          <Text style={styles.adminActionLabel}>Rol instellen</Text>
          <View style={styles.buttonRow}>
            <Button
              title="Gebruiker"
              variant="secondary"
              disabled={disabled}
              onPress={() => onRole(id, 'user')}
            />
            <Button
              title="Moderator"
              variant="secondary"
              disabled={disabled}
              onPress={() => onRole(id, 'moderator')}
            />
          </View>
          <Text style={styles.adminActionLabel}>Accountstatus</Text>
          <View style={styles.buttonRow}>
            <Button
              title="Actief"
              variant="secondary"
              disabled={disabled}
              onPress={() => onStatus(id, 'active')}
            />
            <Button
              title="Uitgeschakeld"
              variant="danger"
              disabled={disabled}
              onPress={() => onStatus(id, 'disabled')}
            />
          </View>
        </>
      ) : null}
    </View>
  );
}

function AdminSupport({ item, isOwner, disabled, onStatus }) {
  const id = itemId(item);
  return (
    <View style={styles.adminRow}>
      <Text style={styles.rowTitle}>{item?.subject || `Verzoek ${id ?? ''}`}</Text>
      <Text style={styles.muted}>
        {item?.email ? `${item.email} · ` : ''}
        Status: {item?.status || 'onbekend'}
      </Text>
      {item?.message ? (
        <Text style={styles.adminDescription} numberOfLines={3}>
          {item.message}
        </Text>
      ) : null}
      {isOwner && id != null ? (
        <View style={styles.buttonRow}>
          <Button
            title="Open"
            variant="secondary"
            disabled={disabled}
            onPress={() => onStatus(id, 'open')}
          />
          <Button
            title="Pending"
            variant="secondary"
            disabled={disabled}
            onPress={() => onStatus(id, 'pending')}
          />
          <Button
            title="Closed"
            variant="secondary"
            disabled={disabled}
            onPress={() => onStatus(id, 'closed')}
          />
        </View>
      ) : null}
    </View>
  );
}

function AdminList({ title, items, renderItem, emptyText }) {
  return (
    <Card title={title}>
      {items.length ? items.map(renderItem) : <Text style={styles.muted}>{emptyText}</Text>}
    </Card>
  );
}

export default function App() {
  const [token, setToken] = useState(null);
  const [booting, setBooting] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingIndex, setOnboardingIndex] = useState(0);
  const [screen, setScreen] = useState('dashboard');
  const [authMode, setAuthMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState(null);
  const [income, setIncome] = useState('');
  const [fixed, setFixed] = useState('');
  const [reserve, setReserve] = useState('');
  const [days, setDays] = useState('30');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [admin, setAdmin] = useState({});
  const [adminBusy, setAdminBusy] = useState(false);

  const applyProfile = useCallback((data) => {
    const profile =
      data?.budgetProfile ||
      data?.data?.budgetProfile ||
      data?.user?.budgetProfile ||
      {};
    if (profile.income != null) setIncome(String(profile.income));
    if (profile.fixed_expenses != null) setFixed(String(profile.fixed_expenses));
    else if (profile.fixedExpenses != null) setFixed(String(profile.fixedExpenses));
    if (profile.reservations != null) setReserve(String(profile.reservations));
    if (profile.days_remaining != null) setDays(String(profile.days_remaining));
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      let savedToken = null;
      let onboardingComplete = false;
      try {
        const values = await Promise.all([
          SecureStore.getItemAsync(TOKEN_KEY),
          SecureStore.getItemAsync(ONBOARDING_KEY),
        ]);
        savedToken = values[0];
        onboardingComplete = values[1] === '1';
        if (savedToken) api.setToken(savedToken);
      } catch (_) {
        if (mounted) setNotice('Inloggen kon niet automatisch worden hersteld.');
      }

      await new Promise((resolve) => setTimeout(resolve, 1400));
      if (!mounted) return;

      if (savedToken) setToken(savedToken);
      if (!onboardingComplete) setShowOnboarding(true);
      setBooting(false);
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const clearSession = useCallback(async () => {
    try {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
    } catch (_) {
      // De sessie wordt ook in het geheugen verwijderd.
    }
    api.setToken(null);
    setToken(null);
    setMe(null);
    setAdmin({});
    setScreen('dashboard');
  }, []);

  const loadMe = useCallback(async () => {
    if (!token || booting) return;
    try {
      const data = await api.getMe();
      setMe(data);
      applyProfile(data);
    } catch (error) {
      if (isUnauthorized(error)) {
        await clearSession();
        setNotice('Je sessie is verlopen. Log opnieuw in.');
      } else {
        setNotice(errorMessage(error, 'Je overzicht laden is mislukt.'));
      }
    }
  }, [token, booting, applyProfile, clearSession]);

  useEffect(() => {
    if (token && !booting) loadMe();
  }, [token, booting, loadMe]);

  const role = getRole(me);
  const isAdmin = role === 'owner' || role === 'moderator';
  const isOwner = role === 'owner';

  const amounts = useMemo(() => {
    const incomeValue = parseAmount(income);
    const fixedValue = parseAmount(fixed);
    const reserveValue = parseAmount(reserve);
    const daysValue = Math.max(1, Math.min(366, Math.floor(parseAmount(days) || 1)));
    const room = incomeValue - fixedValue - reserveValue;
    return {
      income: incomeValue,
      fixed: fixedValue,
      reserve: reserveValue,
      days: daysValue,
      room,
      safeDaily: Math.max(0, room / daysValue),
    };
  }, [income, fixed, reserve, days]);

  const loadAdmin = useCallback(async () => {
    if (!isAdmin) return;
    setAdminBusy(true);
    try {
      const calls = [
        api.getAdminOverview(),
        api.getAdminUsers(),
        api.getAdminSubscriptions(),
        api.getAdminPayouts(),
        api.getAdminSupport(),
      ];
      if (isOwner) calls.push(api.getAdminAudit());
      const results = await Promise.all(calls);
      const next = {
        overview: results[0],
        users: results[1],
        subscriptions: results[2],
        payouts: results[3],
        support: results[4],
      };
      if (isOwner) next.audit = results[5];
      setAdmin(next);
    } catch (error) {
      if (isUnauthorized(error)) {
        await clearSession();
        setNotice('Je sessie is verlopen. Log opnieuw in.');
      } else {
        setNotice(errorMessage(error, 'Beheergegevens laden is mislukt.'));
      }
    } finally {
      setAdminBusy(false);
    }
  }, [isAdmin, isOwner, clearSession]);

  useEffect(() => {
    if (screen === 'admin' && isAdmin) loadAdmin();
  }, [screen, isAdmin, loadAdmin]);

  async function authenticate() {
    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setNotice('Vul je e-mailadres en wachtwoord in.');
      return;
    }
    if (authMode === 'register' && password.length < 10) {
      setNotice('Je wachtwoord moet minimaal 10 tekens bevatten.');
      return;
    }
    if (authMode === 'register' && !name.trim()) {
      setNotice('Vul je naam in.');
      return;
    }

    setNotice('');
    setBusy(true);
    try {
      const result =
        authMode === 'register'
          ? await api.register({ name: name.trim(), email: cleanEmail, password })
          : await api.login({ email: cleanEmail, password });

      const newToken =
        result?.token ||
        result?.accessToken ||
        result?.data?.token ||
        result?.data?.accessToken;

      if (!newToken) {
        setNotice(result?.message || 'Je account is verwerkt. Log in om verder te gaan.');
        if (authMode === 'register') setAuthMode('login');
        return;
      }

      await SecureStore.setItemAsync(TOKEN_KEY, newToken);
      api.setToken(newToken);
      setToken(newToken);
      setScreen('dashboard');
      setPassword('');
      setNotice('');
    } catch (error) {
      setNotice(errorMessage(error, 'Inloggen is mislukt.'));
    } finally {
      setBusy(false);
    }
  }

  async function forgotPassword() {
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setNotice('Vul eerst je e-mailadres in.');
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      await api.requestPasswordReset(cleanEmail);
      setNotice(
        `Als dit e-mailadres bij ons bekend is, ontvang je verdere instructies. Hulp nodig? Mail ${SUPPORT_EMAIL}.`,
      );
    } catch (error) {
      setNotice(errorMessage(error, `Aanvraag mislukt. Neem contact op via ${SUPPORT_EMAIL}.`));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await clearSession();
    setNotice('Je bent uitgelogd.');
  }

  function updateDays(value) {
    const digits = value.replace(/[^0-9]/g, '').slice(0, 3);
    setDays(digits);
  }

  async function saveBudgetProfile() {
    const numericDays = Math.max(1, Math.min(366, Math.floor(parseAmount(days) || 1)));
    setBusy(true);
    setNotice('');
    try {
      await api.updateBudgetProfile({
        income: parseAmount(income),
        fixed_expenses: parseAmount(fixed),
        reservations: parseAmount(reserve),
        days_remaining: numericDays,
      });
      setDays(String(numericDays));
      await loadMe();
      setScreen('dashboard');
      setNotice('Je budgetplan is opgeslagen.');
    } catch (error) {
      if (isUnauthorized(error)) {
        await clearSession();
        setNotice('Je sessie is verlopen. Log opnieuw in.');
      } else {
        setNotice(errorMessage(error, 'Opslaan is mislukt.'));
      }
    } finally {
      setBusy(false);
    }
  }

  async function sendSupportMessage() {
    if (!subject.trim() || !message.trim()) {
      setNotice('Vul een onderwerp en bericht in.');
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      const result = await api.sendSupport({
        subject: subject.trim(),
        message: message.trim(),
      });
      setNotice(result?.message || 'Je bericht is verstuurd. We helpen je graag.');
      setSubject('');
      setMessage('');
    } catch (error) {
      setNotice(errorMessage(error, 'Versturen is mislukt.'));
    } finally {
      setBusy(false);
    }
  }

  async function ownerAction(action) {
    if (!isOwner) return;
    setNotice('');
    setAdminBusy(true);
    try {
      await action();
      setNotice('Wijziging opgeslagen.');
      await loadAdmin();
    } catch (error) {
      setNotice(errorMessage(error, 'Wijziging mislukt.'));
      setAdminBusy(false);
    }
  }

  const openUrl = async (url) => {
    try {
      await Linking.openURL(url);
    } catch (_) {
      setNotice('De link kon niet worden geopend.');
    }
  };

  async function sendOwnerReset() {
    if (!isOwner) return;
    setNotice('');
    setAdminBusy(true);
    try {
      await api.sendOwnerPasswordReset();
      setNotice('Als het e-mailadres van de eigenaar bekend is, zijn resetinstructies verstuurd.');
    } catch (error) {
      setNotice(errorMessage(error, 'De wachtwoordreset kon niet worden verstuurd.'));
    } finally {
      setAdminBusy(false);
    }
  }

  async function finishOnboarding() {
    try {
      await SecureStore.setItemAsync(ONBOARDING_KEY, '1');
    } catch (_) {
      setNotice('De introductievoorkeur kon niet worden opgeslagen.');
    }
    setShowOnboarding(false);
    setOnboardingIndex(0);
  }

  function reopenOnboarding() {
    setOnboardingIndex(0);
    setShowOnboarding(true);
  }

  if (booting) {
    return (
      <View style={styles.splash}>
        <StatusBar style="dark" />
        <BrandMark />
        <Text style={styles.splashBrand}>Saldo Slim</Text>
        <Text style={styles.splashSubtitle}>
          Weet wat je vandaag veilig kunt besteden.
        </Text>
      </View>
    );
  }

  if (showOnboarding) {
    const slide = ONBOARDING_SLIDES[onboardingIndex];
    const lastSlide = onboardingIndex === ONBOARDING_SLIDES.length - 1;
    return (
      <View style={styles.page}>
        <StatusBar style="dark" />
        <ScrollView
          contentContainerStyle={styles.onboardingWrap}
          keyboardShouldPersistTaps="handled"
        >
          <BrandMark />
          <Text style={styles.onboardingBrand}>Saldo Slim</Text>
          <View style={styles.slideCard}>
            <View style={styles.slideMark}>
              <Text style={styles.slideMarkText}>{slide.mark}</Text>
            </View>
            <Text style={styles.slideTitle}>{slide.title}</Text>
            <Text style={styles.slideText}>{slide.text}</Text>
            {onboardingIndex === 3 ? (
              <Text style={styles.smallCenter}>
                Abonnementen lopen via web/Paddle. Betalingen via Google Play zijn
                uitgeschakeld.
              </Text>
            ) : null}
          </View>
          <View style={styles.dots} accessibilityLabel={`Dia ${onboardingIndex + 1} van 4`}>
            {ONBOARDING_SLIDES.map((item, index) => (
              <View
                key={item.mark}
                style={[styles.dot, index === onboardingIndex && styles.dotSelected]}
              />
            ))}
          </View>
          <View style={styles.onboardingButtons}>
            <View style={styles.onboardingButtonCell}>
              <Button
                title="Vorige"
                variant="secondary"
                disabled={onboardingIndex === 0}
                onPress={() => setOnboardingIndex((current) => Math.max(0, current - 1))}
              />
            </View>
            <View style={styles.onboardingButtonCell}>
              <Button
                title={lastSlide ? 'Aan de slag' : 'Volgende'}
                onPress={() =>
                  lastSlide
                    ? finishOnboarding()
                    : setOnboardingIndex((current) =>
                        Math.min(ONBOARDING_SLIDES.length - 1, current + 1),
                      )
                }
              />
            </View>
          </View>
        </ScrollView>
      </View>
    );
  }

  if (!token) {
    return (
      <View style={styles.page}>
        <StatusBar style="dark" />
        <ScrollView
          contentContainerStyle={styles.authWrap}
          keyboardShouldPersistTaps="handled"
        >
          <BrandMark />
          <Text style={styles.brand}>Saldo Slim</Text>
          <Text style={styles.subtitle}>
            Weet wat je vandaag veilig kunt besteden.
          </Text>
          <Card title={authMode === 'login' ? 'Welkom terug' : 'Account aanmaken'}>
            {authMode === 'register' ? (
              <>
                <Label>Naam</Label>
                <Field value={name} onChangeText={setName} placeholder="Je naam" />
              </>
            ) : null}
            <Label>E-mailadres</Label>
            <Field
              value={email}
              onChangeText={setEmail}
              placeholder="naam@voorbeeld.nl"
              keyboardType="email-address"
            />
            <Label>Wachtwoord</Label>
            <View style={styles.passwordRow}>
              <View style={styles.passwordField}>
                <Field
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Wachtwoord"
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={showPassword ? 'Wachtwoord verbergen' : 'Wachtwoord tonen'}
                onPress={() => setShowPassword((current) => !current)}
                style={styles.togglePassword}
              >
                <Text style={styles.togglePasswordText}>
                  {showPassword ? 'Verbergen' : 'Tonen'}
                </Text>
              </Pressable>
            </View>
            {authMode === 'register' ? (
              <Text style={styles.fieldHint}>Gebruik minimaal 10 tekens.</Text>
            ) : null}
            <Button
              title={
                busy
                  ? 'Even wachten…'
                  : authMode === 'login'
                    ? 'Inloggen'
                    : 'Account aanmaken'
              }
              disabled={busy}
              onPress={authenticate}
            />
            {authMode === 'login' ? (
              <Pressable
                accessibilityRole="button"
                onPress={forgotPassword}
                style={styles.linkWrap}
              >
                <Text style={styles.link}>Wachtwoord vergeten?</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setAuthMode(authMode === 'login' ? 'register' : 'login');
                setNotice('');
              }}
              style={styles.linkWrap}
            >
              <Text style={styles.link}>
                {authMode === 'login'
                  ? 'Nog geen account? Registreren'
                  : 'Al een account? Inloggen'}
              </Text>
            </Pressable>
          </Card>
          <Text style={styles.smallCenter}>
            Betaalde abonnementen zijn uitsluitend beschikbaar via web/Paddle.
            Google Play-betalingen zijn uitgeschakeld.
          </Text>
          <Notice
            text={notice}
            onPress={() => setNotice('')}
            onInstall={() => openUrl(INSTALL_URL)}
          />
        </ScrollView>
      </View>
    );
  }

  const overview = admin.overview || {};
  const overviewData = overview?.data || overview;
  const paddleConfigured = overviewData?.paddleApiConfigured === true;
  const users = getArray(admin.users, 'users');
  const subscriptions = getArray(admin.subscriptions, 'subscriptions');
  const payouts = getArray(admin.payouts, 'payouts');
  const supportItems = getArray(admin.support, 'support');
  const auditItems = getArray(admin.audit, 'audit');
  const metrics = compactMetrics(admin.overview);

  return (
    <View style={styles.page}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View style={styles.headerIdentity}>
          <BrandMark small />
          <View>
            <Text style={styles.headerBrand}>Saldo Slim</Text>
            <Text style={styles.headerSub}>Jouw financiële overzicht</Text>
          </View>
        </View>
        <Pressable accessibilityRole="button" onPress={logout} style={styles.logoutButton}>
          <Text style={styles.link}>Uitloggen</Text>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabs}
        contentContainerStyle={styles.tabsContent}
      >
        <Tab title="Overzicht" selected={screen === 'dashboard'} onPress={() => setScreen('dashboard')} />
        <Tab title="Inkomen" selected={screen === 'income'} onPress={() => setScreen('income')} />
        <Tab title="Vaste lasten" selected={screen === 'fixed'} onPress={() => setScreen('fixed')} />
        <Tab title="Reserveren" selected={screen === 'reserve'} onPress={() => setScreen('reserve')} />
        <Tab title="Periode" selected={screen === 'period'} onPress={() => setScreen('period')} />
        <Tab title="Resultaat" selected={screen === 'summary'} onPress={() => setScreen('summary')} />
        <Tab title="Support" selected={screen === 'support'} onPress={() => setScreen('support')} />
        {isAdmin ? (
          <Tab title="Admin" selected={screen === 'admin'} onPress={() => setScreen('admin')} />
        ) : null}
      </ScrollView>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Notice
          text={notice}
          onPress={() => setNotice('')}
          onInstall={() => openUrl(INSTALL_URL)}
        />

        {screen === 'dashboard' ? (
          <>
            <Card>
              <View style={styles.dashboardTopline}>
                <Text style={styles.cardTitle}>Jouw plan</Text>
                <View style={styles.planBadge}>
                  <Text style={styles.planBadgeText}>Budgetoverzicht</Text>
                </View>
              </View>