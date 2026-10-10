import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  Share,
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
  paleBlue: '#EAF1F7',
  paleGreen: '#EAF4EF',
  paleAmber: '#FBF4E4',
  paleRed: '#F9ECEC',
};

const ONBOARDING_SLIDES = [
  {
    title: 'Alles in één overzicht',
    text: 'Breng inkomen, vaste lasten en reserveringen samen in een helder budgetplan.',
    illustration: 'wallet',
  },
  {
    title: 'Een veilig dagbedrag',
    text: 'Zie hoeveel ruimte je per dag hebt en houd rekening met je vaste verplichtingen.',
    illustration: 'shield',
  },
  {
    title: 'Plannen in duidelijke stappen',
    text: 'Vul je bedragen in, kies je periode en bekijk daarna direct je persoonlijke resultaat.',
    illustration: 'path',
  },
  {
    title: 'Jouw gegevens blijven privé',
    text: 'Beheer je abonnement via onze website. Betalingen via Google Play zijn uitgeschakeld.',
    illustration: 'privacy',
  },
];

const FEATURE_DEFINITIONS = [
  { key: 'planning', title: 'Budgetplanning', tier: 'Plus', description: 'Je budgetplan en vaste lasten aanpassen.' },
  { key: 'scenarios', title: 'Scenario’s', tier: 'Plus', description: 'Bekijk wat een aankoop doet met je dagbudget.' },
  { key: 'smart_warnings', title: 'Slimme waarschuwingen', tier: 'Plus', description: 'Krijg extra inzicht bij een krap budget.' },
  { key: 'smart_notifications', title: 'Slimme meldingen', tier: 'Pro', description: 'Tot 25 meldingen per maand; onbeperkt op Max.' },
  { key: 'savings_goals', title: 'Spaardoelen', tier: 'Pro', description: 'Volg je voortgang richting een spaardoel.' },
  { key: 'analyses', title: 'Analyses', tier: 'Pro', description: 'Bekijk vaste lasten en reserveringen als percentage.' },
  { key: 'forecasts', title: 'Prognoses', tier: 'Pro', description: 'Bekijk een eenvoudige veilige bestedingsprognose.' },
  { key: 'export', title: 'Exporteren', tier: 'Pro', description: 'Deel een tekstrapport van je huidige budget.' },
  { key: 'advanced_scenarios', title: 'Geavanceerde scenario’s', tier: 'Max', description: 'Extra ruimte voor uitgebreide scenario’s.' },
  { key: 'longer_outlook', title: 'Langere vooruitblik', tier: 'Max', description: 'Kijk verder vooruit met je budget.' },
  { key: 'protection_warnings', title: 'Beschermingswaarschuwingen', tier: 'Max', description: 'Extra inzicht in mogelijke budgetrisico’s.' },
  { key: 'priority_support', title: 'Prioriteitssupport', tier: 'Max', description: 'Je supportverzoek krijgt prioriteit.' },
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
  return String(error?.code || error?.response?.data?.code || error?.response?.code || '').toLowerCase();
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

function unwrap(data) {
  return data?.data && typeof data.data === 'object' && !Array.isArray(data.data)
    ? data.data
    : data || {};
}

function featureAliases(key) {
  const aliases = {
    planning: ['planning', 'budget_planning', 'fixed_expense_editing', 'fixed_expenses'],
    scenarios: ['scenarios', 'scenario_calculations'],
    smart_warnings: ['smart_warnings', 'warnings'],
    smart_notifications: ['smart_notifications', 'notifications'],
    savings_goals: ['savings_goals', 'goals'],
    analyses: ['analyses', 'analysis'],
    forecasts: ['forecasts', 'forecast'],
    export: ['export', 'exports'],
    advanced_scenarios: ['advanced_scenarios'],
    longer_outlook: ['longer_outlook', 'extended_outlook'],
    protection_warnings: ['protection_warnings', 'risk_warnings'],
    priority_support: ['priority_support'],
  };
  return aliases[key] || [key];
}

function featureValue(features, key) {
  if (!features) return undefined;
  const aliases = featureAliases(key);
  if (Array.isArray(features)) {
    const found = features.find((item) =>
      aliases.includes(String(typeof item === 'string' ? item : item?.key || item?.name || '').toLowerCase()),
    );
    if (found === undefined) return undefined;
    return typeof found === 'object' ? found : true;
  }
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(features, alias)) return features[alias];
  }
  return undefined;
}

function featureIsEnabled(value) {
  if (value === true || value === 'true') return true;
  if (value && typeof value === 'object') {
    return value.enabled === true || value.available === true || value.unlocked === true;
  }
  return false;
}

function featureLimit(value) {
  if (value && typeof value === 'object') {
    const n = Number(value.limit ?? value.max ?? value.monthly_limit);
    return Number.isFinite(n) ? n : null;
  }
  return null;
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
          variant === 'danger' && styles.dangerText,
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
      autoCapitalize={autoCapitalize || (keyboardType === 'email-address' ? 'none' : 'sentences')}
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

function Tab({ title, selected, onPress, badge }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.tab, selected && styles.tabSelected]}
    >
      <Text style={[styles.tabText, selected && styles.tabTextSelected]}>{title}</Text>
      {badge ? <Text style={styles.tabBadge}>{badge}</Text> : null}
    </Pressable>
  );
}

function Notice({ text, onPress, onInstall }) {
  if (!text) return null;
  return (
    <View style={styles.notice}>
      <Text style={styles.noticeText}>{text}</Text>
      {text === 'E-mailprovider moet nog worden ingesteld' ? (
        <Button title="Installatie-informatie openen" variant="secondary" onPress={onInstall} />
      ) : null}
      {onPress ? (
        <Pressable accessibilityRole="button" onPress={onPress} style={styles.noticeClose}>
          <Text style={styles.noticeCloseText}>Sluiten</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Metric({ label, value }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel} numberOfLines={2}>{label}</Text>
      <Text style={styles.metricValue} numberOfLines={2}>{String(value)}</Text>
    </View>
  );
}

function compactMetrics(data) {
  const source = data?.data && !Array.isArray(data.data) ? data.data : data;
  if (!source || typeof source !== 'object') return [];
  const preferred = ['users', 'totalUsers', 'activeUsers', 'subscriptions', 'activeSubscriptions', 'revenue', 'payouts', 'openSupport', 'supportTickets'];
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

function Illustration({ type }) {
  if (type === 'wallet') {
    return (
      <View style={styles.illustration}>
        <View style={styles.walletBack} />
        <View style={styles.wallet}>
          <View style={styles.walletStripe} />
          <View style={styles.walletChip}><Text style={styles.walletChipText}>€</Text></View>
          <View style={styles.walletPocket}><Text style={styles.walletPocketText}>Saldo</Text></View>
          <View style={styles.walletCoin}><Text style={styles.coinText}>€</Text></View>
        </View>
        <View style={styles.walletMiniCard}>
          <Text style={styles.illustrationMiniLabel}>BESCHIKBAAR</Text>
          <Text style={styles.illustrationMiniValue}>€ 420</Text>
        </View>
      </View>
    );
  }
  if (type === 'shield') {
    return (
      <View style={styles.illustration}>
        <View style={styles.shieldShape}>
          <Text style={styles.shieldIcon}>✓</Text>
        </View>
        <View style={styles.dailyCard}>
          <Text style={styles.illustrationMiniLabel}>VEILIG PER DAG</Text>
          <Text style={styles.dailyAmount}>€ 24,50</Text>
          <View style={styles.dailyLine}><View style={styles.dailyLineFill} /></View>
          <Text style={styles.dailyFoot}>Je houdt overzicht</Text>
        </View>
        <View style={styles.shieldSpark}><Text style={styles.sparkText}>+</Text></View>
      </View>
    );
  }
  if (type === 'path') {
    return (
      <View style={styles.illustration}>
        <View style={styles.pathLine} />
        <View style={styles.pathStepRow}>
          <View style={[styles.pathDot, styles.pathDotDone]}><Text style={styles.pathDotText}>1</Text></View>
          <View style={styles.pathStepCard}><Text style={styles.pathStepTitle}>Inkomen</Text><Text style={styles.pathStepSub}>Wat komt er binnen?</Text></View>
        </View>
        <View style={styles.pathStepRow}>
          <View style={[styles.pathDot, styles.pathDotDone]}><Text style={styles.pathDotText}>2</Text></View>
          <View style={styles.pathStepCard}><Text style={styles.pathStepTitle}>Vaste lasten</Text><Text style={styles.pathStepSub}>Wat reserveer je?</Text></View>
        </View>
        <View style={styles.pathStepRow}>
          <View style={styles.pathDot, styles.pathDotLast}><Text style={styles.pathDotText}>3</Text></View>
          <View style={styles.pathStepCard}><Text style={styles.pathStepTitle}>Jouw resultaat</Text><Text style={styles.pathStepSub}>Een duidelijk dagbedrag</Text></View>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.illustration}>
      <View style={styles.privacyCircle}><Text style={styles.privacyLock}>⌑</Text></View>
      <View style={styles.privacyCard}>
        <View style={styles.privacyRow}><View style={styles.privacyDot} /><View style={styles.privacyBar} /><Text style={styles.privacyCheck}>✓</Text></View>
        <View style={styles.privacyRow}><View style={styles.privacyDot} /><View style={[styles.privacyBar, styles.privacyBarShort]} /><Text style={styles.privacyCheck}>✓</Text></View>
        <View style={styles.privacyRow}><View style={styles.privacyDot} /><View style={styles.privacyBar} /><Text style={styles.privacyCheck}>✓</Text></View>
      </View>
      <View style={styles.privacyTag}><Text style={styles.privacyTagText}>PRIVÉ</Text></View>
    </View>
  );
}

function AdminUser({ item, isOwner, disabled, onRole, onStatus }) {
  const id = itemId(item);
  const currentRole = String(item?.role || 'user').toLowerCase();
  const currentStatus = String(item?.status || 'active').toLowerCase();
  const firstName = item?.firstName || item?.first_name || '';
  const lastName = item?.lastName || item?.last_name || '';
  const fullName = [firstName, lastName].filter(Boolean).join(' ') || item?.name || 'Gebruiker';
  return (
    <View style={styles.adminRow}>
      <Text style={styles.rowTitle}>{fullName}</Text>
      <Text style={styles.muted}>Leeftijd: {item?.age ?? '—'} · {item?.email || 'Geen e-mail'}</Text>
      <Text style={styles.muted}>Telefoon: {item?.phone || '—'} · Plan: {item?.plan || '—'}</Text>
      <Text style={styles.muted}>Status: {currentStatus} · Rol: {currentRole}</Text>
      {isOwner && id != null && currentRole !== 'owner' ? (
        <>
          <View style={styles.buttonRow}>
            <Button
              title={currentRole === 'moderator' ? 'Maak gebruiker' : 'Maak moderator'}
              variant="secondary"
              disabled={disabled}
              onPress={() => onRole(id, currentRole === 'moderator' ? 'user' : 'moderator')}
            />
          </View>
          <View style={styles.buttonRow}>
            <Button title="Actief" variant="secondary" disabled={disabled} onPress={() => onStatus(id, 'active')} />
            <Button title="Uitschakelen" variant="danger" disabled={disabled} onPress={() => onStatus(id, 'disabled')} />
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
      <Text style={styles.muted}>{item?.email ? `${item.email} · ` : ''}Status: {item?.status || 'Open'}</Text>
      {item?.message ? <Text style={styles.adminDescription} numberOfLines={3}>{item.message}</Text> : null}
      {isOwner && id != null ? (
        <View style={styles.buttonRow}>
          <Button title="Open" variant="secondary" disabled={disabled} onPress={() => onStatus(id, 'open')} />
          <Button title="Pending" variant="secondary" disabled={disabled} onPress={() => onStatus(id, 'pending')} />
          <Button title="Closed" variant="secondary" disabled={disabled} onPress={() => onStatus(id, 'closed')} />
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
  const [onboardingForSettings, setOnboardingForSettings] = useState(false);
  const [screen, setScreen] = useState('dashboard');
  const [authScreen, setAuthScreen] = useState('choice');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [age, setAge] = useState('');
  const [phone, setPhone] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState(null);
  const [entitlements, setEntitlements] = useState(null);
  const [income, setIncome] = useState('');
  const [fixed, setFixed] = useState('');
  const [reserve, setReserve] = useState('');
  const [days, setDays] = useState('30');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [admin, setAdmin] = useState({});
  const [adminBusy, setAdminBusy] = useState(false);
  const [scenarioAmount, setScenarioAmount] = useState('');
  const [scenarios, setScenarios] = useState([]);
  const [goalTarget, setGoalTarget] = useState('');
  const [goalCurrent, setGoalCurrent] = useState('');

  const applyProfile = useCallback((data) => {
    const profile = data?.budgetProfile || data?.data?.budgetProfile || data?.user?.budgetProfile || {};
    if (profile.income != null) setIncome(String(profile.income));
    if (profile.fixed_expenses != null) setFixed(String(profile.fixed_expenses));
    else if (profile.fixedExpenses != null) setFixed(String(profile.fixedExpenses));
    if (profile.reservations != null) setReserve(String(profile.reservations));
    if (profile.days_remaining != null) setDays(String(profile.days_remaining));
  }, []);

  const clearSession = useCallback(async () => {
    try {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
    } catch (_) {}
    try {
      api.setToken(null);
    } catch (_) {}
    setToken(null);
    setMe(null);
    setEntitlements(null);
    setAdmin({});
    setScreen('dashboard');
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
      if (!onboardingComplete) {
        setOnboardingForSettings(false);
        setShowOnboarding(true);
      }
      setBooting(false);
    })();
    return () => { mounted = false; };
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
        setNotice(errorMessage(error, 'Je profiel laden is mislukt.'));
      }
    }
  }, [token, booting, applyProfile, clearSession]);

  const loadEntitlements = useCallback(async () => {
    if (!token || booting || typeof api.getEntitlements !== 'function') return;
    try {
      const data = await api.getEntitlements();
      setEntitlements(data);
    } catch (error) {
      if (isUnauthorized(error)) {
        await clearSession();
        setNotice('Je sessie is verlopen. Log opnieuw in.');
      } else {
        setNotice(errorMessage(error, 'Je functies konden niet worden geladen.'));
      }
    }
  }, [token, booting, clearSession]);

  useEffect(() => {
    if (token && !booting) {
      loadMe();
      loadEntitlements();
    }
  }, [token, booting, loadMe, loadEntitlements]);

  const role = getRole(me);
  const isAdmin = role === 'owner' || role === 'moderator';
  const isOwner = role === 'owner';
  const entitlementData = unwrap(entitlements);
  const features = entitlementData?.features || entitlementData?.entitlements?.features || null;
  const planName = isAdmin ? 'Lifetime Premium (gratis)' : String(entitlementData?.effectivePlan || entitlementData?.plan || entitlementData?.subscription?.plan || entitlementData?.planName || 'Gratis');
  const hasFeature = useCallback((key) => isAdmin || featureIsEnabled(featureValue(features, key)), [isAdmin, features]);

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
      if (isOwner && typeof api.getAdminAudit === 'function') calls.push(api.getAdminAudit());
      const results = await Promise.all(calls);
      setAdmin({
        overview: results[0],
        users: results[1],
        subscriptions: results[2],
        payouts: results[3],
        support: results[4],
        ...(isOwner && results[5] ? { audit: results[5] } : {}),
      });
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

  async function authenticate(mode) {
    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setNotice('Vul je e-mailadres en wachtwoord in.');
      return;
    }
    if (mode === 'register') {
      const numericAge = Number(age);
      if (!firstName.trim() || !lastName.trim() || !age.trim() || !cleanEmail || !phone.trim() || !password) {
        setNotice('Vul alle verplichte registratievelden in.');
        return;
      }
      if (!Number.isInteger(numericAge) || numericAge < 16 || numericAge > 120) {
        setNotice('Leeftijd moet een heel getal van 16 tot en met 120 zijn.');
        return;
      }
      if (password.length < 10) {
        setNotice('Je wachtwoord moet minimaal 10 tekens bevatten.');
        return;
      }
    }
    setNotice('');
    setBusy(true);
    try {
      const result = mode === 'register'
        ? await api.register({
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            age: Number(age),
            email: cleanEmail,
            phone: phone.trim(),
            password,
          })
        : await api.login({ email: cleanEmail, password });
      const newToken = result?.token || result?.accessToken || result?.data?.token || result?.data?.accessToken;
      if (!newToken) {
        setNotice(result?.message || 'Je registratie is verwerkt. Log in om verder te gaan.');
        if (mode === 'register') {
          setPassword('');
          setAuthScreen('login');
        }
        return;
      }
      await SecureStore.setItemAsync(TOKEN_KEY, newToken);
      api.setToken(newToken);
      setToken(newToken);
      setScreen('dashboard');
      setPassword('');
      setNotice('');
    } catch (error) {
      setNotice(errorMessage(error, mode === 'register' ? 'Registreren is mislukt.' : 'Inloggen is mislukt.'));
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
      setNotice(`Als dit e-mailadres bij ons bekend is, ontvang je verdere instructies. Hulp nodig? Mail ${SUPPORT_EMAIL}.`);
    } catch (error) {
      setNotice(errorMessage(error, `Aanvraag mislukt. Neem contact op via ${SUPPORT_EMAIL}.`));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await clearSession();
    setNotice('Je bent uitgelogd.');
    setAuthScreen('choice');
  }

  function updateDays(value) {
    setDays(value.replace(/[^0-9]/g, '').slice(0, 3));
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
      const result = await api.sendSupport({ subject: subject.trim(), message: message.trim() });
      setNotice(result?.message || 'Je bericht is verstuurd. We helpen je graag.');
      setSubject('');
      setMessage('');
    } catch (error) {
      if (isUnauthorized(error)) {
        await clearSession();
        setNotice('Je sessie is verlopen. Log opnieuw in.');
      } else {
        setNotice(errorMessage(error, 'Versturen is mislukt.'));
      }
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
      if (isUnauthorized(error)) {
        await clearSession();
        setNotice('Je sessie is verlopen. Log opnieuw in.');
      } else {
        setNotice(errorMessage(error, 'Wijziging mislukt.'));
      }
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
    if (!isOwner || typeof api.sendOwnerPasswordReset !== 'function') return;
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
    if (onboardingForSettings && token) {
      setScreen('dashboard');
      setOnboardingForSettings(false);
    } else if (!token) {
      setAuthScreen('choice');
    }
  }

  function reopenOnboarding() {
    setOnboardingIndex(0);
    setOnboardingForSettings(true);
    setShowOnboarding(true);
  }

  function openFeature(feature) {
    if (!hasFeature(feature.key)) {
      openUrl(WEB_ACCOUNT);
      return;
    }
    if (feature.key === 'planning') {
      setScreen('income');
      return;
    }
    setScreen(`feature:${feature.key}`);
  }

  function addScenario() {
    if (!hasFeature('scenarios')) {
      openUrl(WEB_ACCOUNT);
      return;
    }
    const value = parseAmount(scenarioAmount);
    if (value <= 0) {
      setNotice('Vul een aankoopbedrag