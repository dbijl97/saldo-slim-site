import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import api from './src/api';

const TOKEN_KEY = 'saldo_slim_token';
const C = { navy: '#163A5F', green: '#2F7D5B', yellow: '#E3A323', red: '#B64242', bg: '#F5F7F8', white: '#FFFFFF', ink: '#203040', muted: '#617181', line: '#DCE3E8' };
const WEB_ACCOUNT = 'https://saldo-slim.onrender.com/account.html';
const SUPPORT_EMAIL = 'info@partydj-dylan.nl';

function getRole(data) {
  return String(data?.user?.role || data?.role || data?.me?.role || '').toLowerCase();
}
function getArray(data, key) {
  const value = data?.[key] ?? data?.data?.[key] ?? data?.items ?? data?.data;
  return Array.isArray(value) ? value : [];
}
function itemId(item) { return item?.id ?? item?._id ?? item?.userId ?? item?.subscriptionId ?? item?.ticketId; }
function pretty(value) {
  if (value === undefined || value === null) return 'Geen gegevens beschikbaar.';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch (_) { return String(value); }
}

function Button({ title, onPress, variant = 'primary', disabled = false }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.button, variant === 'secondary' && styles.buttonSecondary, variant === 'danger' && styles.buttonDanger, disabled && styles.disabled]}><Text style={[styles.buttonText, variant === 'secondary' && styles.secondaryText]}>{title}</Text></Pressable>;
}
function Field({ value, onChangeText, placeholder, secureTextEntry, keyboardType, multiline }) {
  return <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={C.muted} secureTextEntry={secureTextEntry} keyboardType={keyboardType} multiline={multiline} autoCapitalize={keyboardType === 'email-address' ? 'none' : 'sentences'} style={[styles.input, multiline && styles.multiline]} />;
}
function Card({ title, children }) {
  return <View style={styles.card}>{title ? <Text style={styles.cardTitle}>{title}</Text> : null}{children}</View>;
}

export default function App() {
  const [token, setToken] = useState(null);
  const [booting, setBooting] = useState(true);
  const [screen, setScreen] = useState('dashboard');
  const [authMode, setAuthMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
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

  useEffect(() => {
    (async () => {
      try {
        const saved = await SecureStore.getItemAsync(TOKEN_KEY);
        if (saved) { api.setToken(saved); setToken(saved); }
      } catch (_) { setNotice('Inloggen kon niet automatisch worden hersteld.'); }
      finally { setBooting(false); }
    })();
  }, []);

  const loadMe = useCallback(async () => {
    if (!token) return;
    try {
      const data = await api.getMe();
      setMe(data);
      const profile = data?.financialProfile || data?.financial_profile || data?.profile || data?.user?.financialProfile || {};
      if (profile.income != null) setIncome(String(profile.income));
      if (profile.fixed != null) setFixed(String(profile.fixed));
      if (profile.reserve != null) setReserve(String(profile.reserve));
      if (profile.days != null) setDays(String(profile.days));
    } catch (e) { setNotice(e.message || 'Dashboard laden is mislukt.'); }
  }, [token]);

  useEffect(() => { loadMe(); }, [loadMe]);

  const role = getRole(me);
  const isAdmin = role === 'owner' || role === 'moderator';
  const isOwner = role === 'owner';
  const safeToSpend = useMemo(() => {
    const nIncome = Number(income) || 0;
    const nFixed = Number(fixed) || 0;
    const nReserve = Number(reserve) || 0;
    const nDays = Number(days);
    return Math.max(0, (nIncome - nFixed - nReserve) / (nDays > 0 ? nDays : 1));
  }, [income, fixed, reserve, days]);

  const loadAdmin = useCallback(async () => {
    if (!isAdmin) return;
    setAdminBusy(true);
    try {
      const calls = [api.getAdminOverview(), api.getAdminUsers(), api.getAdminSubscriptions(), api.getAdminPayouts(), api.getAdminSupport()];
      if (isOwner) calls.push(api.getAdminAudit());
      const results = await Promise.all(calls);
      const next = { overview: results[0], users: results[1], subscriptions: results[2], payouts: results[3], support: results[4] };
      if (isOwner) next.audit = results[5];
      setAdmin(next);
    } catch (e) { setNotice(e.message || 'Beheergegevens laden is mislukt.'); }
    finally { setAdminBusy(false); }
  }, [isAdmin, isOwner]);
  useEffect(() => { if (screen === 'admin' && isAdmin) loadAdmin(); }, [screen, isAdmin, loadAdmin]);

  async function authenticate() {
    setNotice(''); setBusy(true);
    try {
      const result = authMode === 'register'
        ? await api.register({ name, email: email.trim(), password })
        : await api.login({ email: email.trim(), password });
      const newToken = result?.token || result?.accessToken || result?.data?.token || result?.data?.accessToken;
      if (!newToken) {
        setNotice(result?.message || 'Je account is verwerkt. Log in om verder te gaan.');
        if (authMode === 'register') setAuthMode('login');
        return;
      }
      await SecureStore.setItemAsync(TOKEN_KEY, newToken);
      api.setToken(newToken); setToken(newToken); setScreen('dashboard'); setPassword('');
    } catch (e) { setNotice(e.message || 'Inloggen is mislukt.'); }
    finally { setBusy(false); }
  }

  async function forgotPassword() {
    if (!email.trim()) { setNotice('Vul eerst je e-mailadres in.'); return; }
    setBusy(true); setNotice('');
    try {
      await api.passwordHelp(email.trim());
      setNotice(`Als dit e-mailadres bij ons bekend is, ontvang je verdere instructies. Hulp nodig? Mail ${SUPPORT_EMAIL}.`);
    } catch (e) { setNotice(e.message || 'Aanvraag mislukt. Neem contact op via ' + SUPPORT_EMAIL + '.'); }
    finally { setBusy(false); }
  }

  async function logout() {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    api.setToken(null); setToken(null); setMe(null); setAdmin({}); setScreen('dashboard'); setNotice('Je bent uitgelogd.');
  }

  async function saveFinancialProfile() {
    setBusy(true); setNotice('');
    try {
      const result = await api.updateFinancialProfile({ income: Number(income) || 0, fixed: Number(fixed) || 0, reserve: Number(reserve) || 0, days: Math.max(1, Number(days) || 1) });
      setNotice(result?.message || 'Je financiële profiel is opgeslagen.');
      await loadMe();
    } catch (e) { setNotice(e.message || 'Opslaan is mislukt.'); }
    finally { setBusy(false); }
  }

  async function sendSupport() {
    if (!subject.trim() || !message.trim()) { setNotice('Vul een onderwerp en bericht in.'); return; }
    setBusy(true); setNotice('');
    try {
      const result = await api.sendSupport({ subject: subject.trim(), message: message.trim() });
      setNotice(result?.message || 'Je bericht is verstuurd.'); setSubject(''); setMessage('');
    } catch (e) { setNotice(e.message || 'Versturen is mislukt.'); }
    finally { setBusy(false); }
  }

  async function ownerAction(action, id, payload = {}) {
    if (!isOwner || id == null) return;
    setNotice(''); setAdminBusy(true);
    try { await action(id, payload); setNotice('Wijziging opgeslagen.'); await loadAdmin(); }
    catch (e) { setNotice(e.message || 'Wijziging mislukt.'); setAdminBusy(false); }
  }

  const openUrl = async (url) => { try { await Linking.openURL(url); } catch (_) { setNotice('De link kon niet worden geopend.'); } };
  const overview = admin.overview || {};
  const paddleConfigured = overview?.paddleApiConfigured === true || overview?.data?.paddleApiConfigured === true;

  if (booting) return <View style={styles.center}><ActivityIndicator size="large" color={C.green} /><Text style={styles.muted}>Saldo Slim laden…</Text></View>;

  if (!token) return <View style={styles.page}><StatusBar style="dark" /><ScrollView contentContainerStyle={styles.authWrap} keyboardShouldPersistTaps="handled">
    <Text style={styles.brand}>Saldo Slim</Text><Text style={styles.subtitle}>Rust en overzicht in je geldzaken.</Text>
    <Card title={authMode === 'login' ? 'Inloggen' : 'Account aanmaken'}>
      {authMode === 'register' && <Field value={name} onChangeText={setName} placeholder="Naam" />}
      <Field value={email} onChangeText={setEmail} placeholder="E-mailadres" keyboardType="email-address" />
      <Field value={password} onChangeText={setPassword} placeholder="Wachtwoord" secureTextEntry />
      <Button title={busy ? 'Even wachten…' : authMode === 'login' ? 'Inloggen' : 'Registreren'} disabled={busy} onPress={authenticate} />
      {authMode === 'login' && <Pressable onPress={forgotPassword} style={styles.linkWrap}><Text style={styles.link}>Wachtwoord vergeten?</Text></Pressable>}
      <Pressable onPress={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setNotice(''); }} style={styles.linkWrap}><Text style={styles.link}>{authMode === 'login' ? 'Nog geen account? Registreren' : 'Al een account? Inloggen'}</Text></Pressable>
    </Card>
    <Text style={styles.smallCenter}>Betaalde abonnementen zijn uitsluitend beschikbaar via web/Paddle. Google Play-betalingen zijn uitgeschakeld.</Text>
    {!!notice && <Text style={styles.notice}>{notice}</Text>}
  </ScrollView></View>;

  return <View style={styles.page}><StatusBar style="dark" />
    <View style={styles.header}><View><Text style={styles.headerBrand}>Saldo Slim</Text><Text style={styles.headerSub}>Jouw financiële overzicht</Text></View><Pressable onPress={logout}><Text style={styles.link}>Uitloggen</Text></Pressable></View>
    <View style={styles.tabs}>
      <Tab title="Overzicht" selected={screen === 'dashboard'} onPress={() => setScreen('dashboard')} />
      <Tab title="Support" selected={screen === 'support'} onPress={() => setScreen('support')} />
      {isAdmin && <Tab title="Admin" selected={screen === 'admin'} onPress={() => setScreen('admin')} />}
    </View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {!!notice && <Pressable onPress={() => setNotice('')}><Text style={styles.notice}>{notice}  ×</Text></Pressable>}
      {screen === 'dashboard' && <>
        <Card title="Veilig te besteden per dag"><Text style={styles.amount}>€ {safeToSpend.toFixed(2).replace('.', ',')}</Text><Text style={styles.muted}>Berekend op basis van je inkomen, vaste lasten, reserve en periode.</Text></Card>
        <Card title="Financieel profiel">
          <Label>Inkomen per periode (€)</Label><Field value={income} onChangeText={setIncome} placeholder="Bijv. 2500" keyboardType="decimal-pad" />
          <Label>Vaste lasten (€)</Label><Field value={fixed} onChangeText={setFixed} placeholder="Bijv. 1200" keyboardType="decimal-pad" />
          <Label>Reserve (€)</Label><Field value={reserve} onChangeText={setReserve} placeholder="Bijv. 300" keyboardType="decimal-pad" />
          <Label>Aantal dagen</Label><Field value={days} onChangeText={setDays} placeholder="30" keyboardType="number-pad" />
          <Button title={busy ? 'Opslaan…' : 'Profiel opslaan'} onPress={saveFinancialProfile} disabled={busy} />
        </Card>
        <Card title="Abonnement"><Text style={styles.body}>Beheer je betaalde abonnement veilig via onze website.</Text><Button title="Abonnement beheren via web" variant="secondary" onPress={() => openUrl(WEB_ACCOUNT)} /></Card>
        <Card title="Betalingen"><Text style={styles.body}>Google Play-betalingen zijn uitgeschakeld. Betaalde plannen zijn alleen beschikbaar via web/Paddle.</Text></Card>
      </>}
      {screen === 'support' && <Card title="Contact met support"><Text style={styles.body}>Stuur ons je vraag; we helpen je graag.</Text><Field value={subject} onChangeText={setSubject} placeholder="Onderwerp" /><Field value={message} onChangeText={setMessage} placeholder="Je bericht" multiline /><Button title={busy ? 'Versturen…' : 'Bericht versturen'} onPress={sendSupport} disabled={busy} /><Pressable onPress={() => openUrl(`mailto:${SUPPORT_EMAIL}`)} style={styles.linkWrap}><Text style={styles.link}>{SUPPORT_EMAIL}</Text></Pressable></Card>}
      {screen === 'admin' && isAdmin && <>
        <Card title={`Beheer${isOwner ? ' · Owner' : ' · Moderator (alleen-lezen)'}`}>
          <Text style={styles.body}>{isOwner ? 'Je hebt beheerrechten.' : 'Moderatorweergave is strikt alleen-lezen.'}</Text>
          {adminBusy && <ActivityIndicator color={C.green} />}
          <Button title="Gegevens vernieuwen" variant="secondary" onPress={loadAdmin} disabled={adminBusy} />
        </Card>
        <DataSection title="Overzicht" data={admin.overview} />
        <Card title="Gebruikers"><JsonBlock data={admin.users} />{getArray(admin.users, 'users').map((item, i) => <AdminUser key={String(itemId(item) ?? i)} item={item} isOwner={isOwner} onRole={(id, roleValue) => ownerAction(api.setAdminUserRole, id, { role: roleValue })} onStatus={(id, statusValue) => ownerAction(api.setAdminUserStatus, id, { status: statusValue })} />)}</Card>
        <Card title="Abonnementen"><JsonBlock data={admin.subscriptions} />{getArray(admin.subscriptions, 'subscriptions').map((item, i) => <View key={String(itemId(item) ?? i)} style={styles.adminRow}><Text style={styles.rowTitle}>Abonnement {String(itemId(item) ?? '')}</Text><Text style={styles.muted}>{item?.status || item?.plan || ''}</Text>{isOwner && paddleConfigured && itemId(item) != null && <Button title="Direct annuleren via Paddle" variant="danger" disabled={adminBusy} onPress={() => ownerAction(api.cancelAdminSubscription, itemId(item), {})} />}</View>)}</Card>
        <Card title="Uitbetalingen"><Text style={styles.body}>Payout- en bankinstellingen zijn niet bewerkbaar in Saldo Slim; beheer gevoelige instellingen rechtstreeks bij Paddle.</Text><JsonBlock data={admin.payouts} /><Button title="Paddle-dashboard openen" variant="secondary" onPress={() => openUrl('https://vendors.paddle.com/')} /></Card>
        <Card title="Supportverzoeken"><JsonBlock data={admin.support} />{getArray(admin.support, 'support').map((item, i) => <AdminSupport key={String(itemId(item) ?? i)} item={item} isOwner={isOwner} disabled={adminBusy} onStatus={(id, statusValue) => ownerAction(api.setAdminSupportStatus, id, { status: statusValue })} />)}</Card>
        {isOwner && <DataSection title="Auditlog" data={admin.audit} />}
      </>}
    </ScrollView>
  </View>;
}

function Tab({ title, selected, onPress }) {
  return <Pressable onPress={onPress} style={[styles.tab, selected && styles.tabSelected]}><Text style={[styles.tabText, selected && styles.tabTextSelected]}>{title}</Text></Pressable>;
}
function Label({ children }) { return <Text style={styles.label}>{children}</Text>; }
function JsonBlock({ data }) { return <Text selectable style={styles.json}>{pretty(data)}</Text>; }
function DataSection({ title, data }) { return <Card title={title}><JsonBlock data={data} /></Card>; }
function AdminUser({ item, isOwner, onRole, onStatus }) {
  const id = itemId(item);
  if (!isOwner || id == null) return null;
  const currentRole = String(item?.role || 'user').toLowerCase();
  const currentStatus = String(item?.status || 'active').toLowerCase();
  return <View style={styles.adminRow}><Text style={styles.rowTitle}>{item?.name || item?.email || `Gebruiker ${id}`}</Text><Text style={styles.muted}>Rol: {currentRole} · Status: {currentStatus}</Text>
    <View style={styles.buttonRow}><Button title="Rol: user" variant="secondary" onPress={() => onRole(id, 'user')} /><Button title="Rol: moderator" variant="secondary" onPress={() => onRole(id, 'moderator')} /><Button title="Rol: owner" variant="secondary" onPress={() => onRole(id, 'owner')} /></View>
    <View style={styles.buttonRow}><Button title="Actief" variant="secondary" onPress={() => onStatus(id, 'active')} /><Button title="Geblokkeerd" variant="danger" onPress={() => onStatus(id, 'suspended')} /></View>
  </View>;
}
function AdminSupport({ item, isOwner, disabled, onStatus }) {
  const id = itemId(item);
  return <View style={styles.adminRow}><Text style={styles.rowTitle}>{item?.subject || `Verzoek ${id ?? ''}`}</Text><Text style={styles.muted}>{item?.status || ''}</Text>{isOwner && id != null && <View style={styles.buttonRow}><Button title="Open" variant="secondary" disabled={disabled} onPress={() => onStatus(id, 'open')} /><Button title="In behandeling" variant="secondary" disabled={disabled} onPress={() => onStatus(id, 'in_progress')} /><Button title="Afgerond" variant="secondary" disabled={disabled} onPress={() => onStatus(id, 'resolved')} /></View>}</View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, gap: 12 },
  authWrap: { flexGrow: 1, justifyContent: 'center', padding: 22 }, brand: { color: C.navy, fontSize: 34, fontWeight: '800', textAlign: 'center' }, subtitle: { color: C.muted, textAlign: 'center', marginTop: 5, marginBottom: 22 },
  header: { paddingTop: 48, paddingHorizontal: 18, paddingBottom: 14, backgroundColor: C.white, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, headerBrand: { color: C.navy, fontWeight: '800', fontSize: 22 }, headerSub: { color: C.muted, fontSize: 12, marginTop: 2 },
  tabs: { flexDirection: 'row', backgroundColor: C.white, borderBottomWidth: 1, borderColor: C.line, paddingHorizontal: 10 }, tab: { paddingHorizontal: 14, paddingVertical: 13, borderBottomWidth: 3, borderBottomColor: 'transparent' }, tabSelected: { borderBottomColor: C.green }, tabText: { color: C.muted, fontWeight: '600' }, tabTextSelected: { color: C.green },
  content: { padding: 16, paddingBottom: 40 }, card: { backgroundColor: C.white, borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: C.line }, cardTitle: { fontSize: 17, fontWeight: '700', color: C.navy, marginBottom: 12 }, amount: { color: C.green, fontSize: 36, fontWeight: '800', marginBottom: 5 }, muted: { color: C.muted, fontSize: 13, lineHeight: 19 }, body: { color: C.ink, fontSize: 14, lineHeight: 21, marginBottom: 10 },
  input: { minHeight: 46, borderWidth: 1, borderColor: C.line, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 10, color: C.ink, backgroundColor: C.white, marginBottom: 11, fontSize: 15 }, multiline: { minHeight: 110, textAlignVertical: 'top' }, label: { color: C.ink, fontSize: 13, fontWeight: '600', marginBottom: 5 },
  button: { backgroundColor: C.green, borderRadius: 9, paddingHorizontal: 14, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', marginTop: 5, marginBottom: 5 }, buttonSecondary: { backgroundColor: '#EAF1ED', borderWidth: 1, borderColor: '#C7DCCF' }, buttonDanger: { backgroundColor: C.red }, buttonText: { color: C.white, fontWeight: '700', fontSize: 14 }, secondaryText: { color: C.green }, disabled: { opacity: 0.55 }, linkWrap: { alignItems: 'center', paddingVertical: 9 }, link: { color: C.navy, fontWeight: '700', textDecorationLine: 'underline' }, notice: { backgroundColor: '#FFF5DA', color: C.navy, padding: 12, borderRadius: 9, marginBottom: 12, lineHeight: 20 }, smallCenter: { color: C.muted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 5 }, json: { color: C.ink, fontSize: 12, lineHeight: 17, marginBottom: 8 }, adminRow: { borderTopWidth: 1, borderColor: C.line, paddingTop: 12, marginTop: 10 }, rowTitle: { color: C.navy, fontWeight: '700', fontSize: 14, marginBottom: 4 }, buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 5 }
});
