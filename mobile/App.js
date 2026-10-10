import React,{useEffect,useState} from 'react';
import {View,Text,TextInput,Pressable,ScrollView,ActivityIndicator,Linking,StyleSheet} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import {StatusBar} from 'expo-status-bar';
import api from './src/api';
import FinanceTools from './src/FinanceTools';
import {RoutexClient,AccountField,Result,Dialog,Redirect,RedirectHandle} from 'react-native-routex-client';
const BLUE='#173c60',GREEN='#2d805f';
const intro=[['Welkom bij Saldo Slim','Krijg inzicht in je geld en houd grip op je dagelijkse budget.'],['Bereken je bestedingsruimte','Vul je inkomsten, vaste lasten en reserve in en zie wat je per dag kunt besteden.'],['Jouw mogelijkheden','Bekijk je abonnement, vraag hulp aan en beheer als eigenaar je gebruikers.']];
function Btn({title,onPress,secondary=false}){return <Pressable onPress={onPress} style={[styles.button,secondary&&{backgroundColor:BLUE}]}><Text style={styles.buttonText}>{title}</Text></Pressable>}
function Field({label,value,onChangeText,secureTextEntry=false,keyboardType='default'}){return <View style={{marginBottom:12}}><Text style={styles.label}>{label}</Text><TextInput style={styles.input} value={value} onChangeText={onChangeText} secureTextEntry={secureTextEntry} keyboardType={keyboardType} autoCapitalize={keyboardType==='email-address'?'none':'sentences'}/></View>}
function Card({title,children}){return <View style={styles.card}><Text style={styles.heading}>{title}</Text>{children}</View>}
export default function App(){
 const [bankDialogValue,setBankDialogValue]=useState(''),[bankCallbackReceived,setBankCallbackReceived]=useState(false);
 const [stage,setStage]=useState('loading'),[slide,setSlide]=useState(0),[mode,setMode]=useState('login'),[tab,setTab]=useState('overzicht');
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[firstName,setFirstName]=useState(''),[lastName,setLastName]=useState(''),[age,setAge]=useState(''),[phone,setPhone]=useState('');
 const [token,setToken]=useState(''),[me,setMe]=useState(null),[ent,setEnt]=useState(null),[budget,setBudget]=useState({income:'',fixed_expenses:'',reservations:'',days_remaining:'30'}),[admin,setAdmin]=useState({}),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[subject,setSubject]=useState(''),[message,setMessage]=useState(''),[bankStatus,setBankStatus]=useState(null),[bankData,setBankData]=useState(null),[bankQuery,setBankQuery]=useState(''),[bankMatches,setBankMatches]=useState([]),[bankSelected,setBankSelected]=useState(null),[bankUser,setBankUser]=useState(''),[bankPassword,setBankPassword]=useState(''),[bankDialog,setBankDialog]=useState(null),[bankTicket,setBankTicket]=useState(null);
 const role=String(me?.role||'').toLowerCase(),privileged=['owner','moderator'].includes(role),owner=role==='owner';
 const enabled=k=>privileged||Boolean(ent?.features?.[k]);
 const [scenario,setScenario]=useState('100'),[goal,setGoal]=useState('1000'),[months,setMonths]=useState('12'),[noticeThreshold,setNoticeThreshold]=useState('10');
 const n=v=>Number(String(v||'0').replace(',','.'))||0;
 const daily=(n(budget.income)-n(budget.fixed_expenses)-n(budget.reservations))/Math.max(1,n(budget.days_remaining));
 const fail=e=>setNotice(e?.message||'Er is iets misgegaan.');
 async function loadProfile(){const [p,e,b]=await Promise.all([api.getMe(),api.getEntitlements(),api.getBudgetProfile()]);setMe(p.user||p);setEnt(e);const q=b.budgetProfile||b.profile||b.budget||b;setBudget({income:String(q.income??''),fixed_expenses:String(q.fixed_expenses??q.fixedExpenses??''),reservations:String(q.reservations??''),days_remaining:String(q.days_remaining??q.daysRemaining??30)});}
 useEffect(()=>{(async()=>{try{const t=await SecureStore.getItemAsync('saldoSlimToken');const seen=await SecureStore.getItemAsync('saldoSlimIntro');if(t){api.setToken(t);setToken(t);await loadProfile();setStage('app')}else setStage(seen?'auth':'intro')}catch(e){setStage('auth')}})()},[]);
 async function authenticate(){setBusy(true);setNotice('');try{const response=mode==='register'?await api.register({firstName,lastName,age:Number(age),phone,email,password}):await api.login({email,password});if(mode==='register'&&!response.token){setMode('login');setNotice('Registratie gelukt. Log nu in.');return}const t=response.token;if(!t)throw Error('Log opnieuw in.');await SecureStore.setItemAsync('saldoSlimToken',t);api.setToken(t);setToken(t);await loadProfile();setStage('app')}catch(e){fail(e)}finally{setBusy(false)}}
 async function loadBankStatus(){try{const [status,data]=await Promise.all([api.getBankConnectStatus(),api.getBankData().catch(()=>null)]);setBankStatus(status);setBankData(data)}catch(e){fail(e)}}
 const makeBankClient=()=>new RoutexClient(bankStatus?.environment?.toLowerCase()==='integration'?{url:new URL('https://integration.yaxi.tech/')}:undefined);
 const bankCallback='saldoslim://bank-callback';
 useEffect(()=>{
   const sub=Linking.addEventListener('url',({url})=>{
     if(url?.startsWith(bankCallback)){setBankCallbackReceived(true);setNotice('Terug van je bank. Rond de autorisatie af met Bankbevestiging controleren.');}
   });
   return ()=>sub.remove();
 },[]);
 async function findBanks(){
   setBusy(true);setNotice('');
   try{
     const query=bankQuery.trim();
     if(!query)throw new Error('Vul een banknaam of IBAN in.');
     const issued=await api.createBankTicket({service:'Accounts'});
     const client=makeBankClient();
     const matches=await client.search({ticket:issued.ticket,filters:query.split(/\\s+/).filter(Boolean).map(term=>({term})),ibanDetection:true,limit:20});
     setBankMatches(Array.isArray(matches)?matches:matches?.connections||[]);
     setBankSelected(null);setBankDialog(null);
     setNotice('Kies je bank uit de resultaten.');
   }catch(e){fail(e)}finally{setBusy(false)}
 }
 async function startBankConnection(){
   setBusy(true);setNotice('');setBankCallbackReceived(false);
   try{
     if(!bankSelected?.id)throw new Error('Kies eerst een bank.');
     const issued=await api.createBankTicket({service:'Accounts'});
     const client=makeBankClient();
     await client.setRedirectUri(bankCallback);
     const credentials={connectionId:bankSelected.id};
     if(bankUser.trim())credentials.userId=bankUser.trim();
     if(bankPassword)credentials.password=bankPassword;
     const response=await client.accounts({ticket:issued.ticket,credentials,fields:[AccountField.Iban,AccountField.Currency,AccountField.OwnerName]});
     setBankPassword('');
     await handleBankResponse(response,issued.ticket,client);
   }catch(e){setBankPassword('');fail(e)}finally{setBusy(false)}
 }
 async function handleBankResponse(response,ticket,client){
   const kind=response?.constructor?.name||'Onbekend';
   const result=response instanceof Result?response:response?.result;
   const jwt=result?.jwt||result?.authenticated?.jwt;
   if(jwt){
     await api.submitBankResult(jwt);
     setBankDialog(null);setBankDialogValue('');setBankCallbackReceived(false);
     setNotice('Bankrekening veilig gekoppeld.');
     await loadBankStatus();
     return;
   }
   const redirect=response instanceof Redirect?response:response?.redirect;
   const redirectHandle=response instanceof RedirectHandle?response:response?.redirectHandle;
   let redirectUrl=redirect?.url;
   const redirectContext=redirect?.context||redirectHandle?.context;
   if(redirectHandle?.handle){
     const registered=await client.registerRedirectUri({ticket,handle:redirectHandle.handle,redirectUri:bankCallback});
     redirectUrl=typeof registered==='string'?registered:registered?.url;
   }
   if(redirectUrl){
     const redirectAddress=typeof redirectUrl==='string'?redirectUrl:(typeof redirectUrl?.href==='string'?redirectUrl.href:typeof redirectUrl?.toString==='function'?redirectUrl.toString():'');
     if(!redirectAddress.startsWith('https://'))throw new Error('Ongeldige bankredirect-URL.');
     if(!redirectContext)throw new Error('YAXI gaf geen redirectcontext terug.');
     setBankDialog({ticket,context:redirectContext,kind:'redirect'});
     await Linking.openURL(redirectAddress);
     setNotice('Rond de autorisatie af in je bankomgeving. Daarna kun je de bevestiging controleren.');
     return;
   }
   const input=response instanceof Dialog?response.input:response?.dialog?.input||response?.input;
   if(input?.context){
     setBankDialog({ticket,context:input.context,kind:'dialog',input});
     setBankDialogValue('');
     setNotice(response?.message||'Bevestig de aanvraag bij je bank.');
     return;
   }
   throw new Error('Onbekend YAXI-antwoordtype: '+kind+'. Er is niets gekoppeld.');
 }
 async function confirmBankDialog(){
   if(!bankDialog||busy)return;
   setBusy(true);setNotice('');
   try{
     const client=makeBankClient();
     const {ticket,context,input,kind}=bankDialog;
     if(!context)throw new Error('Bevestigingscontext ontbreekt.');
     const inputKind=input?.constructor?.name?.toLowerCase()||'';
     const isChoice=inputKind.includes('selection')||Array.isArray(input?.options)||Array.isArray(input?.choices);
     const isField=inputKind.includes('field')||input?.type==='field';
     const response=(kind==='dialog'&&(isChoice||isField))
       ?await client.respondAccounts({ticket,context,response:bankDialogValue})
       :await client.confirmAccounts({ticket,context});
     await handleBankResponse(response,ticket,client);
   }catch(e){fail(e)}finally{setBusy(false)}
 }
 async function logout(){await SecureStore.deleteItemAsync('saldoSlimToken');api.setToken(null);setToken('');setMe(null);setStage('auth');setTab('overzicht')}
 async function saveBudget(){setBusy(true);setNotice('');try{await api.updateBudgetProfile({income:n(budget.income),fixed_expenses:n(budget.fixed_expenses),reservations:n(budget.reservations),days_remaining:Math.max(1,n(budget.days_remaining))});setNotice('Je financiële profiel is opgeslagen.')}catch(e){fail(e)}finally{setBusy(false)}}
 async function loadAdmin(){setBusy(true);setNotice('');try{const [overview,users,subscriptions,payouts,support,audit]=await Promise.all([api.getAdminOverview(),api.getAdminUsers(),api.getAdminSubscriptions(),api.getAdminPayouts(),api.getAdminSupport(),owner?api.getAdminAudit():Promise.resolve({audit:[]})]);setAdmin({overview,users:users.users||[],subscriptions:subscriptions.subscriptions||[],payouts:payouts.payouts||[],support:support.tickets||[],audit:audit.audit||[]})}catch(e){fail(e)}finally{setBusy(false)}}
 async function changeRole(id,role){try{await api.setAdminUserRole(id,{role});await loadAdmin()}catch(e){fail(e)}}
 async function changeStatus(id,status){try{await api.setAdminUserStatus(id,{status});await loadAdmin()}catch(e){fail(e)}}
 async function sendSupport(){setBusy(true);try{await api.sendSupport({subject,message});setSubject('');setMessage('');setNotice('Je bericht is verzonden.')}catch(e){fail(e)}finally{setBusy(false)}}
 if(stage==='loading')return <View style={styles.center}><ActivityIndicator size='large' color={GREEN}/><Text>Saldo Slim wordt gestart…</Text></View>;
 if(stage==='intro')return <View style={styles.page}><Text style={styles.logo}>Saldo Slim</Text><Card title={intro[slide][0]}><Text style={styles.body}>{intro[slide][1]}</Text><Text style={styles.muted}>Stap {slide+1} van {intro.length}</Text></Card><Btn title={slide===intro.length-1?'Aan de slag':'Volgende'} onPress={async()=>{if(slide<intro.length-1)setSlide(slide+1);else{await SecureStore.setItemAsync('saldoSlimIntro','1');setStage('auth')}}}/><Btn secondary title='Overslaan' onPress={()=>setStage('auth')}/></View>;
 if(stage==='auth')return <ScrollView contentContainerStyle={styles.page}><Text style={styles.logo}>Saldo Slim</Text><Text style={styles.body}>Jouw financiële overzicht</Text><View style={styles.tabs}><Btn title='Inloggen' onPress={()=>setMode('login')}/><Btn title='Registreren' secondary onPress={()=>setMode('register')}/></View><Card title={mode==='login'?'Inloggen':'Registreren'}>{mode==='register'&&<><Field label='Voornaam' value={firstName} onChangeText={setFirstName}/><Field label='Achternaam' value={lastName} onChangeText={setLastName}/><Field label='Leeftijd' value={age} onChangeText={setAge} keyboardType='numeric'/><Field label='Telefoonnummer' value={phone} onChangeText={setPhone} keyboardType='phone-pad'/></>}<Field label='E-mailadres' value={email} onChangeText={setEmail} keyboardType='email-address'/><Field label='Wachtwoord' value={password} onChangeText={setPassword} secureTextEntry/><Btn title={busy?'Even wachten…':mode==='login'?'Inloggen':'Account aanmaken'} onPress={authenticate}/></Card>{!!notice&&<Text style={styles.notice}>{notice}</Text>}</ScrollView>;
 return <ScrollView contentContainerStyle={styles.page}><StatusBar style='dark'/><Text style={styles.logo}>Saldo Slim</Text><Text style={styles.body}>Welkom, {me?.firstName||me?.name||'gebruiker'}</Text><Text style={styles.muted}>{privileged?'Lifetime Premium (gratis)':ent?.effectivePlan||me?.plan||'Basis'}</Text><View style={styles.tabs}>{['overzicht','planning','spaardoel','scenario','analyse','waarschuwingen','bankconnect','support',...(privileged?['admin']:[])].map(x=><Pressable key={x} onPress={()=>{setTab(x);setNotice('');if(x==='admin')loadAdmin();if(x==='bankconnect')loadBankStatus()}}><Text style={[styles.nav,tab===x&&{color:GREEN}]}>{x==='overzicht'?'Overzicht':x==='admin'?'Admin':x==='spaardoel'?'Spaardoel':x==='bankconnect'?'BankConnect':x.charAt(0).toUpperCase()+x.slice(1)}</Text></Pressable>)}</View>{!!notice&&<Text style={styles.notice}>{notice}</Text>}
 {tab==='overzicht'&&<><Card title='Veilig te besteden per dag'><Text style={styles.amount}>€ {daily.toFixed(2).replace('.',',')}</Text><Text style={styles.muted}>Op basis van inkomsten, vaste lasten, reserve en periode.</Text></Card><Card title='Financieel profiel'>{[['Inkomen per periode (€)','income'],['Vaste lasten (€)','fixed_expenses'],['Reserve (€)','reservations'],['Aantal dagen','days_remaining']].map(([label,key])=><Field key={key} label={label} value={budget[key]} keyboardType='decimal-pad' onChangeText={v=>setBudget({...budget,[key]:v})}/>)}<Btn title='Profiel opslaan' onPress={saveBudget}/></Card><Card title='Abonnement'><Text style={styles.body}>{privileged?'Alle functies zijn gratis vrijgeschakeld.':ent?.effectivePlan||me?.plan||'Basis'}</Text><Btn secondary title='Bekijk abonnementen' onPress={()=>Linking.openURL('https://partydj-dylan.nl/account.html')}/></Card></>}

 {tab==='planning'&&<Card title='Financiële planning'>{enabled('planning')?<><Text style={styles.body}>Beschikbaar na vaste lasten en reserveringen: € {(n(budget.income)-n(budget.fixed_expenses)-n(budget.reservations)).toFixed(2)}</Text><Text>Per week: € {(daily*7).toFixed(2)}</Text><Text>Per dag: € {daily.toFixed(2)}</Text><Text style={styles.muted}>Pas de bedragen aan onder Overzicht om je planning te veranderen.</Text></>:<Text>Planning is beschikbaar vanaf Plus.</Text>}</Card>}
 {tab==='spaardoel'&&<Card title='Spaardoel berekenen'>{enabled('savingsGoals')?<><Field label='Gewenst spaarbedrag (€)' value={goal} onChangeText={setGoal} keyboardType='decimal-pad'/><Field label='Binnen hoeveel maanden?' value={months} onChangeText={setMonths} keyboardType='numeric'/><Text style={styles.amount}>€ {(n(goal)/Math.max(1,n(months))).toFixed(2)}</Text><Text>Dit bedrag moet je per maand sparen.</Text></>:<Text>Spaardoelen zijn beschikbaar vanaf Pro.</Text>}</Card>}
 {tab==='scenario'&&<Card title='Wat-als-berekening'>{enabled('scenarios3')?<><Field label='Extra uitgave (€)' value={scenario} onChangeText={setScenario} keyboardType='decimal-pad'/><Text style={styles.amount}>€ {(daily-n(scenario)/Math.max(1,n(budget.days_remaining))).toFixed(2)}</Text><Text>Dagbudget na deze extra uitgave.</Text>{enabled('advancedScenarios')&&<Text style={styles.muted}>Max: onbeperkt scenario's doorrekenen.</Text>}</>:<Text>Scenario's zijn beschikbaar vanaf Plus.</Text>}</Card>}
 {tab==='analyse'&&<Card title='Financiële analyse'>{enabled('analyses')?<><Text>Inkomsten: € {n(budget.income).toFixed(2)}</Text><Text>Vaste lasten: € {n(budget.fixed_expenses).toFixed(2)}</Text><Text>Reserve: € {n(budget.reservations).toFixed(2)}</Text><Text>Vrij besteedbaar: € {(n(budget.income)-n(budget.fixed_expenses)-n(budget.reservations)).toFixed(2)}</Text><Text>Percentage vaste lasten: {n(budget.income)>0?(100*n(budget.fixed_expenses)/n(budget.income)).toFixed(1):'0'}%</Text></>:<Text>Analyses zijn beschikbaar vanaf Pro.</Text>}</Card>}
 {tab==='waarschuwingen'&&<Card title='Budgetwaarschuwingen'>{enabled('smartWarnings')?<><Field label='Waarschuw bij dagbudget onder (€)' value={noticeThreshold} onChangeText={setNoticeThreshold} keyboardType='decimal-pad'/><Text style={styles.body}>{daily<0?'Let op: je budget is negatief.':daily<n(noticeThreshold)?'Waarschuwing: je dagbudget is lager dan de grens.':'Je dagbudget ligt boven de ingestelde grens.'}</Text><Text style={styles.muted}>Dit is een waarschuwing in de app, geen pushmelding.</Text></>:<Text>Slimme waarschuwingen zijn beschikbaar vanaf Plus.</Text>}</Card>}
 {tab==='bankconnect'&&<Card title='Saldo Slim BankConnect (YAXI)'>{!enabled('bankConnect')?<Text>BankConnect is beschikbaar voor Pro en Max.</Text>:<><Text style={styles.body}>Bankrekeningen, saldi en transacties voor je financiële planning.</Text><Text style={styles.muted}>API: {bankStatus?.configured?'Geconfigureerd':'Niet bevestigd'}</Text><Text style={styles.muted}>Bankautorisatie: {Array.isArray(bankData?.accounts)&&bankData.accounts.length>0?'bankgegevens ontvangen via YAXI':'nog geen bankrekening gekoppeld'}.</Text>{!(Array.isArray(bankData?.accounts)&&bankData.accounts.length>0)&&<Text style={styles.muted}>Bankgegevens worden pas getoond na veilige autorisatie via YAXI.</Text>}<Text>{enabled('bankAdvancedSettings')?'Max: uitgebreide instellingen':'Pro: beperkte instellingen'}</Text>{bankData?.lastUpdated&&<><Text style={styles.body}>Laatst bijgewerkt: {new Date(bankData.lastUpdated).toLocaleDateString('nl-NL')}</Text><Text>Inkomsten: € {bankData.analysis?.income?.toFixed(2)}</Text><Text>Uitgaven: € {bankData.analysis?.expenses?.toFixed(2)}</Text><Text>Netto: € {bankData.analysis?.net?.toFixed(2)}</Text><Text>Transacties: {bankData.analysis?.transactionCount}</Text>{(bankData.accounts||[]).map((a,i)=><Text key={i}>{a.iban||'Rekening'} ({a.currency||'EUR'})</Text>)}{(bankData.transactions||[]).slice(0,15).map((t,i)=><Text key={i}>{t.bookingDate||''} · {t.creditor?.name||t.debtor?.name||'Transactie'} · {t.amount?.amount} {t.amount?.currency}</Text>)}</>}<Field label='Zoek je bank (naam of IBAN)' value={bankQuery} onChangeText={setBankQuery}/><Btn title='Zoek banken' onPress={findBanks}/>{bankMatches.slice(0,12).map((b,i)=><Btn key={i} secondary title={b.name||b.displayName||b.id} onPress={()=>{setBankSelected(b);setBankDialog(null)}}/>)}{bankSelected&&<><Text style={styles.body}>Gekozen bank: {bankSelected.name||bankSelected.displayName}</Text><Field label='Gebruikersnaam bank (indien vereist)' value={bankUser} onChangeText={setBankUser}/><Field label='Bankwachtwoord (indien vereist)' value={bankPassword} secureTextEntry onChangeText={setBankPassword}/><Btn title='Bankverbinding starten' onPress={startBankConnection}/></>}{bankDialog&&<><Text style={styles.body}>{bankDialog.kind==='redirect'?(bankCallbackReceived?'Terug van bank. Controleer de bevestiging.':'Voltooi eerst de autorisatie bij je bank.'):'Bevestiging van de bank'}</Text>{bankDialog.kind==='dialog'&&bankDialog.input&&(bankDialog.input?.constructor?.name==='Field'||bankDialog.input?.constructor?.name==='Selection'||Array.isArray(bankDialog.input?.options))&&<><Field label='Antwoord voor de bank' value={bankDialogValue} onChangeText={setBankDialogValue}/>{(bankDialog.input?.options||bankDialog.input?.choices||[]).map((o,i)=><Btn key={i} secondary title={String(o.label||o.name||o.key||o.value||o)} onPress={()=>setBankDialogValue(String(o.key||o.value||o))}/>)}</>}<Btn title='Bankbevestiging controleren' onPress={confirmBankDialog}/></>}<Btn title='Status en transacties vernieuwen' onPress={loadBankStatus}/></>}</Card>}
 {tab==='bankconnect'&&enabled('bankConnect')&&<FinanceTools bankData={bankData} userKey={me?.id||me?.email||email}/>}
 {tab==='support'&&<Card title='Contact met ondersteuning'><Field label='Onderwerp' value={subject} onChangeText={setSubject}/><Field label='Bericht' value={message} onChangeText={setMessage}/><Btn title='Verstuur bericht' onPress={sendSupport}/></Card>}
 {tab==='admin'&&privileged&&<><Card title='Beheer'><Text style={styles.body}>Rol: {owner?'Eigenaar':'Moderator'}</Text><Btn title='Vernieuw gegevens' onPress={loadAdmin}/></Card><Card title='Dashboard'><Text>Gebruikers: {admin.overview?.totalUsers??'—'}</Text><Text>Abonnementen: {admin.overview?.totalSubscriptions??'—'}</Text></Card><Card title='Gebruikers'>{(admin.users||[]).map(u=><View key={u.id} style={styles.entry}><Text>{u.name} — {u.email}</Text><Text>{u.role} · {u.status}</Text>{owner&&u.role!=='owner'&&<><Btn title={u.role==='moderator'?'Maak gebruiker':'Maak moderator'} onPress={()=>changeRole(u.id,u.role==='moderator'?'user':'moderator')}/><Btn secondary title={u.status==='active'?'Deactiveer':'Activeer'} onPress={()=>changeStatus(u.id,u.status==='active'?'disabled':'active')}/></>}</View>)}</Card><Card title='Abonnementen'><Text>{(admin.subscriptions||[]).length} abonnementen</Text></Card><Card title='Uitbetalingen'><Text>{(admin.payouts||[]).length} uitbetalingen</Text></Card><Card title='Supporttickets'><Text>{(admin.support||[]).length} tickets</Text></Card>{owner&&<Card title='Auditlog'><Text>{(admin.audit||[]).length} regels</Text></Card>}</>}
 <Btn secondary title='Uitloggen' onPress={logout}/></ScrollView>
}
const styles=StyleSheet.create({page:{padding:22,paddingTop:55,backgroundColor:'#f3f6f8',flexGrow:1},center:{flex:1,justifyContent:'center',alignItems:'center'},logo:{fontSize:34,fontWeight:'800',color:BLUE,marginBottom:12},heading:{fontSize:23,fontWeight:'700',color:BLUE,marginBottom:18},body:{fontSize:17,color:BLUE,marginBottom:15},muted:{fontSize:15,color:'#657789',marginTop:8},card:{backgroundColor:'#fff',padding:20,borderRadius:18,marginVertical:12,borderWidth:1,borderColor:'#d8e0e5'},label:{fontSize:16,fontWeight:'600',color:BLUE,marginBottom:8},input:{borderWidth:1,borderColor:'#cdd7de',borderRadius:10,padding:12,fontSize:17,color:BLUE},button:{backgroundColor:GREEN,padding:14,borderRadius:10,alignItems:'center',marginVertical:7},buttonText:{color:'#fff',fontSize:16,fontWeight:'700'},tabs:{flexDirection:'row',justifyContent:'space-around',gap:8,marginVertical:15,flexWrap:'wrap'},nav:{fontSize:18,fontWeight:'700',color:BLUE},amount:{fontSize:40,color:GREEN,fontWeight:'800'},notice:{padding:14,backgroundColor:'#fff1c9',borderRadius:10,color:BLUE,marginVertical:10},entry:{paddingVertical:12,borderBottomWidth:1,borderColor:'#e0e6eb'}});
