'use strict';
/* Mi Contabilidad – Visor (solo lectura, sin internet).
   Abre el archivo .mcvisor que se crea en la Mac (cifrado AES-256-GCM con PBKDF2-SHA256) y muestra los datos.
   Nada sale del teléfono: no hay conexiones a internet (lo impide también la Content-Security-Policy). */

const BLOQUEO_MS = 5 * 60 * 1000;   // 5 minutos en segundo plano = se bloquea
const AAD = new TextEncoder().encode('mi-contabilidad-visor-v1');
let D = null;                       // datos descifrados (solo en memoria)
let vista = { p: 'inicio' };
let pila = [];
let ocultoDesde = null;
let fallos = 0, esperarHasta = 0, mensaje = '', archivoPendiente = null, hojaAbierta = false;
let opciones = { lado: 'cobrar', periodo: 'anual', estado: 'resultados', miles: false };

const $app = document.getElementById('app');
const $archivo = document.getElementById('archivo');

/* ---------- utilidades ---------- */
const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
function dinero(v, dec = 2) {
  if (v == null || v === '') return '';
  if (typeof v === 'string') return E(v);
  if (Math.abs(v) < 0.005) return '–';
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return v < 0 ? `(${s})` : s;
}
const plano = v => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = v => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
function compacto(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k';
  return String(Math.round(v));
}
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fecha = f => f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : '';
const fechaLarga = f => f ? `${+f.slice(8, 10)} ${MESES[+f.slice(5, 7) - 1]} ${f.slice(0, 4)}` : '';
const unid = (u, c) => (Math.abs(c - 1) < 1e-9 || /s$/.test(u)) ? u : (/[lrnd]$/.test(u) ? u + 'es' : u + 's');
const iniciales = n => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase();
function valor(v, fm) {
  if (Array.isArray(v)) { fm = v[0]; v = v[1]; }
  if (v == null || v === '') return '';
  if (fm === 'p') return (v * 100).toFixed(1) + '%';
  if (fm === 'r') return v.toFixed(2) + 'x';
  if (fm === 'd') return Math.round(v) + ' d';
  if (fm === 'e') return String(v);
  if (fm === 't' || typeof v === 'string') return E(v);
  return opciones.miles ? dinero(v / 1000, 1) : dinero(v);
}
const esNeg = v => { if (Array.isArray(v)) v = v[1]; return typeof v === 'number' && v < -0.004; };

/* ---------- iconos de línea ---------- */
const P = {
  inicio: '<path d="M4 11.5 12 5l8 6.5"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/>',
  caja: '<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M16 12.5h2"/><path d="M3 9.5h18"/>',
  banco: '<path d="M3 10 12 4l9 6"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8"/><path d="M3 20h18"/>',
  efectivo: '<rect x="3" y="7" width="18" height="11" rx="2"/><circle cx="12" cy="12.5" r="2.5"/><path d="M6.5 10v.01M17.5 15v.01"/>',
  recibo: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  caja3d: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  grafico: '<path d="M4 19h16"/><path d="M7 15l4-5 3 3 5-6"/>',
  candado: '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  der: '<path d="m9 6 6 6-6 6"/>', izq: '<path d="m15 6-6 6 6 6"/>',
  mas: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  entra: '<path d="M17 7 7 17M7 9v8h8"/>', sale: '<path d="M7 17 17 7M9 7h8v8"/>',
  persona: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c1-3.5 4-5 7-5s6 1.5 7 5"/>',
  alerta: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4M12 17v.01"/>',
  lista: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6v.01M4.5 12v.01M4.5 18v.01"/>',
  merma: '<path d="M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  costo: '<path d="M4 15h3l2-6h6l2 6h3"/><circle cx="8" cy="17.5" r="1.5"/><circle cx="16" cy="17.5" r="1.5"/>',
  archivo: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
};
const ic = (n, c = '') => `<svg class="i ${c}" viewBox="0 0 24 24" aria-hidden="true">${P[n] || ''}</svg>`;

/* ---------- almacenamiento local (solo el archivo cifrado) ---------- */
function bd() {
  return new Promise((ok, mal) => {
    const r = indexedDB.open('mcvisor', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('k');
    r.onsuccess = () => ok(r.result); r.onerror = () => mal(r.error);
  });
}
async function guardar(k, v) { const b = await bd(); return new Promise(ok => { const t = b.transaction('k', 'readwrite'); t.objectStore('k').put(v, k); t.oncomplete = ok; t.onerror = ok; }); }
async function leer(k) { try { const b = await bd(); return await new Promise(ok => { const r = b.transaction('k').objectStore('k').get(k); r.onsuccess = () => ok(r.result); r.onerror = () => ok(null); }); } catch (e) { return null; } }
async function borrar(k) { const b = await bd(); return new Promise(ok => { const t = b.transaction('k', 'readwrite'); t.objectStore('k').delete(k); t.oncomplete = ok; }); }

/* ---------- descifrar ---------- */
async function descifrar(texto, clave) {
  let d;
  try { d = JSON.parse(texto); } catch (e) { throw new Error('archivo'); }
  if (!d || d.tipo !== 'mi-contabilidad-visor') throw new Error('archivo');
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(clave), 'PBKDF2', false, ['deriveKey']);
  const llave = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(d.sal), iterations: d.vueltas, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(d.iv), additionalData: AAD }, llave, b64(d.datos));
  return JSON.parse(new TextDecoder().decode(pt));
}

/* ---------- navegación ---------- */
function ir(p, extra) { pila.push(vista); vista = Object.assign({ p }, extra || {}); pintar(); window.scrollTo(0, 0); }
function atras() { vista = pila.pop() || { p: 'inicio' }; pintar(); }
function pestana(p) { pila = []; vista = { p }; pintar(); window.scrollTo(0, 0); }
function bloquear() { D = null; pila = []; vista = { p: 'inicio' }; mensaje = ''; hojaAbierta = false; pintar(); }

document.addEventListener('visibilitychange', () => {
  if (document.hidden) ocultoDesde = Date.now();
  else if (ocultoDesde && Date.now() - ocultoDesde > BLOQUEO_MS && D) { mensaje = 'Se bloqueó por seguridad.'; bloquear(); }
});
function bordeNav() { const n = document.querySelector('.nav'); if (n && !n.classList.contains('siempre')) n.classList.toggle('con-borde', window.scrollY > 34); }
window.addEventListener('scroll', bordeNav, { passive: true });
document.addEventListener('scroll', bordeNav, { passive: true, capture: true });

/* ---------- pantalla de bloqueo ---------- */
async function pintarEntrar() {
  const hay = await leer('archivo');
  const tengo = !!(archivoPendiente || hay);
  $app.innerHTML = `<div class="bloqueo">
    <div class="logo">Σ</div>
    <h1>Mi Contabilidad</h1>
    <p>${tengo ? (archivoPendiente ? 'Archivo nuevo: ' + E(archivoPendiente.nombre) : 'Tus datos están guardados y cifrados en este teléfono.') : 'Visor del teléfono · solo lectura · sin internet'}</p>
    ${mensaje ? `<p class="error">${E(mensaje)}</p>` : ''}
    ${tengo ? `
      <label class="campo">${ic('candado')}<input type="password" id="clave" placeholder="Contraseña del móvil" autocomplete="current-password" enterkeyhint="go"></label>
      <button class="btn" data-accion="abrir">Abrir</button>
      <button class="btn sec" data-accion="cargar">Cargar otro archivo</button>`
    : `<div class="pasos"><b>Para empezar</b><ol>
        <li>En la Mac: <b>Más → Ver en el iPhone</b> y crea el archivo.</li>
        <li>Pásalo por <b>AirDrop</b> y guárdalo en <b>Archivos</b>.</li>
        <li>Toca <b>Cargar archivo</b> y elígelo.</li></ol></div>
      <button class="btn" data-accion="cargar">Cargar archivo</button>`}
    <div class="sello">${ic('candado')} Cifrado AES-256 · nada sale de este teléfono</div>
  </div>`;
  const c = document.getElementById('clave');
  if (c) { c.focus(); c.addEventListener('keydown', e => { if (e.key === 'Enter') abrir(); }); }
}

async function abrir() {
  const c = document.getElementById('clave');
  if (!c || !c.value) return;
  if (Date.now() < esperarHasta) { mensaje = `Demasiados intentos. Espera ${Math.ceil((esperarHasta - Date.now()) / 1000)} s.`; return pintar(); }
  const boton = document.querySelector('[data-accion="abrir"]');
  if (boton) { boton.textContent = 'Abriendo…'; boton.disabled = true; }
  const fuente = archivoPendiente || await leer('archivo');
  try {
    D = await descifrar(fuente.texto, c.value);
    if (archivoPendiente) { await guardar('archivo', archivoPendiente); archivoPendiente = null; }
    fallos = 0; mensaje = ''; pila = []; vista = { p: 'inicio' };
  } catch (e) {
    if (e.message === 'archivo') { mensaje = 'Ese archivo no es de Mi Contabilidad. Créalo en la Mac (Más → Ver en el iPhone).'; archivoPendiente = null; }
    else {
      fallos++;
      mensaje = 'Contraseña incorrecta.';
      if (fallos >= 5) { esperarHasta = Date.now() + 30000 * Math.pow(2, Math.floor(fallos / 5) - 1); mensaje += ' Espera antes de volver a probar.'; }
    }
  }
  pintar();
}

$archivo.addEventListener('change', () => {
  const f = $archivo.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => { archivoPendiente = { texto: String(r.result), nombre: f.name, cargado: new Date().toISOString() }; D = null; mensaje = ''; pintar(); };
  r.readAsText(f);
  $archivo.value = '';
});

/* ---------- piezas ---------- */
function nav(titulo, conAtras, siempre) {
  return `<header class="nav ${siempre ? 'siempre con-borde' : ''}">
    <div class="izq">${conAtras ? `<button class="izq" data-accion="atras">${ic('izq')}Atrás</button>` : ''}</div>
    <div class="titulo">${E(titulo)}</div>
    <div class="der"><button data-accion="menu" aria-label="Opciones">${ic('mas')}</button></div></header>`;
}
function encabezado(titulo) {
  const creado = new Date(D.creado);
  const dias = Math.floor((Date.now() - creado.getTime()) / 86400000);
  const cuando = `${creado.toLocaleDateString('es', { day: 'numeric', month: 'short' })}, ${creado.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}`;
  return `<h1 class="titulo-grande">${E(titulo)}</h1>
    <p class="subtitulo ${dias >= 3 ? 'viejo' : ''}"><span class="punto"></span>Datos del ${cuando}${dias >= 1 ? ` · hace ${dias} día${dias > 1 ? 's' : ''}` : ''}</p>
    ${dias >= 3 ? '<div class="aviso-viejo">Estos datos tienen varios días. Para verlos al día, crea un archivo nuevo en la Mac y cárgalo.</div>' : ''}`;
}
function delta(actual, anterior, alReves) {
  if (anterior == null || Math.abs(anterior) < 0.005) return '';
  const c = (actual - anterior) / Math.abs(anterior);
  if (!isFinite(c)) return '';
  const bueno = alReves ? c < 0 : c > 0;
  const cl = Math.abs(c) < 0.0005 ? 'neutro' : (bueno ? 'sube' : 'baja');
  return `<span class="delta ${cl}">${c >= 0 ? '▲' : '▼'} ${Math.abs(c * 100).toFixed(1)}%</span>`;
}
function spark(serie) {
  if (!serie.length) return '';
  const w = 320, h = 56, min = Math.min(0, ...serie), max = Math.max(0, ...serie), r = (max - min) || 1;
  const pts = serie.map((v, i) => [i * w / Math.max(serie.length - 1, 1), h - 4 - (v - min) / r * (h - 8)]);
  const linea = pts.map(p => p.map(x => x.toFixed(1)).join(',')).join(' ');
  const cero = h - 4 - (0 - min) / r * (h - 8);
  const ultimo = serie[serie.length - 1];
  const col = ultimo >= 0 ? 'var(--pos)' : 'var(--neg)';
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="gs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".25"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    <line x1="0" x2="${w}" y1="${cero.toFixed(1)}" y2="${cero.toFixed(1)}" stroke="var(--sep)" stroke-dasharray="3 3"/>
    <polygon points="0,${h} ${linea} ${w},${h}" fill="url(#gs)"/>
    <polyline points="${linea}" fill="none" stroke="${col}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <circle cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}" r="3.5" fill="${col}"/></svg>`;
}
function barras(g) {
  const w = 340, h = 150, izq = 34, abajo = 18, arriba = 8;
  const max = Math.max(1, ...g.map(m => Math.max(m.ing, m.gas)));
  const bruto = max / 4, mag = Math.pow(10, Math.floor(Math.log10(bruto)));
  const paso = [1, 2, 2.5, 5, 10].map(x => x * mag).find(x => x >= bruto), tope = paso * 4;
  const alto = h - abajo - arriba, ancho = (w - izq) / g.length;
  let s = `<svg class="grafico" viewBox="0 0 ${w} ${h}" aria-label="Ventas y gastos por mes">`;
  for (let k = 0; k <= 4; k++) {
    const y = arriba + alto - alto * k / 4;
    s += `<line class="rejilla" x1="${izq}" x2="${w}" y1="${y}" y2="${y}"/><text x="${izq - 5}" y="${y + 3}" text-anchor="end">${compacto(paso * k)}</text>`;
  }
  g.forEach((m, i) => {
    const x = izq + i * ancho, bw = ancho * 0.32;
    const h1 = Math.max(0, m.ing) / tope * alto, h2 = Math.max(0, m.gas) / tope * alto;
    s += `<rect x="${(x + ancho * 0.16).toFixed(1)}" y="${(arriba + alto - h1).toFixed(1)}" width="${bw.toFixed(1)}" height="${h1.toFixed(1)}" rx="2" fill="var(--bar1)"/>`;
    s += `<rect x="${(x + ancho * 0.16 + bw + 1.5).toFixed(1)}" y="${(arriba + alto - h2).toFixed(1)}" width="${bw.toFixed(1)}" height="${h2.toFixed(1)}" rx="2" fill="var(--bar2)"/>`;
    s += `<text x="${(x + ancho / 2).toFixed(1)}" y="${h - 4}" text-anchor="middle">${E(m.etq.slice(0, 1))}</text>`;
  });
  return s + '</svg>';
}
const COL_ANTIG = ['#0f766e', '#f2a65a', '#e8890c', '#d9730b', '#d92d20', '#94a3b8'];
const NOM_ANTIG = ['Por vencer', '1-30 días', '31-60 días', '61-90 días', 'Más de 90', 'Sin factura'];
function antiguedad(tr) {
  const pos = tr.map(v => Math.max(0, v)), tot = pos.reduce((a, b) => a + b, 0);
  if (tot < 0.01) return '';
  return `<div class="apilada">${pos.map((v, i) => v > 0 ? `<i style="width:${(v / tot * 100).toFixed(2)}%;background:${COL_ANTIG[i]}"></i>` : '').join('')}</div>
    <div class="ley-antig">${pos.map((v, i) => v > 0.004 ? `<div><span><i style="background:${COL_ANTIG[i]}"></i>${NOM_ANTIG[i]}</span><b class="num">${compacto(v)}</b></div>` : '').join('')}</div>`;
}
function tablaTikr(inf) {
  let h = `<div class="tikr"><table><tr><th>${E(inf.titulo)}</th>${inf.columnas.map(c => `<th>${E(c)}</th>`).join('')}</tr>`;
  for (const f of inf.filas) {
    h += `<tr class="${E(f.s)}"><td class="n${f.n}">${E(f.e)}</td>`;
    if (!f.v.length) h += inf.columnas.map(() => '<td></td>').join('');
    f.v.forEach((v, i) => {
      const fm = f.f || inf.formatos[i] || 'n';
      const t = valor(v, fm);
      h += `<td class="${esNeg(v) ? 'neg' : ''}">${t || (f.s === 'pct' ? '' : '–')}</td>`;
    });
    h += '</tr>';
  }
  return h + '</table></div>';
}
const tipoCaja = n => /Banco|Zelle|Tarjeta|exterior/i.test(n) ? 'banco' : 'efectivo';
function tabbar() {
  const r = raiz();
  return `<nav class="tabbar">${[['inicio', 'inicio', 'Inicio'], ['cajas', 'caja', 'Caja'], ['deudas', 'recibo', 'Deudas'], ['inventario', 'caja3d', 'Inventario'], ['estados', 'grafico', 'Estados']]
    .map(([p, i, t]) => `<button data-tab="${p}" class="${r === p ? 'on' : ''}">${ic(i)}${t}</button>`).join('')}</nav>`;
}
function raiz() { const p = (pila[0] || vista).p; return ({ caja: 'cajas', persona: 'deudas', producto: 'inventario', movimientos: 'inicio' })[p] || p; }
const item = (o) => `<div class="item ${o.tocar ? 'tocar' : ''}" ${o.attr || ''}>
  ${o.ic ? `<span class="ic ${o.icc || ''}">${o.ic.startsWith('<') ? o.ic : ic(o.ic)}</span>` : ''}
  <div class="t"><b>${o.t}</b>${o.s ? `<small>${o.s}</small>` : ''}</div>
  ${o.v != null ? `<div class="val ${o.vc || ''}">${o.v}${o.vs ? `<small>${o.vs}</small>` : ''}</div>` : ''}
  ${o.tocar ? `<span class="chev">${ic('der')}</span>` : ''}</div>`;
const avatar = n => `<b style="font-size:13px">${E(iniciales(n))}</b>`;

/* ---------- pantallas ---------- */
function vInicio() {
  const r = D.resumen, b = D.base, g = D.grafico;
  const actual = g[g.length - 1] || { ing: 0, gas: 0 }, previo = g[g.length - 2];
  const resultados = g.map(m => m.ing - m.gas);
  const deb = D.cobrar.total, debo = D.pagar.total;
  const top = D.top_gastos.slice(0, 5), maxTop = Math.max(1, ...top.map(x => x.v));
  return nav(D.empresa) + `<main>${encabezado(D.empresa)}
    <div class="card hero">
      <div class="etiqueta">Efectivo disponible</div>
      <div class="cifra num">${plano(r.efectivo)} <small>${b}</small></div>
      ${D.tasa ? `<span class="muted" style="font-size:12.5px">Tasa ${num(D.tasa)} CUP = 1 USD</span>` : ''}
      ${spark(resultados)}
      <div class="muted" style="font-size:11.5px;margin-top:2px">Resultado de los últimos 12 meses</div>
      ${D.balance ? `<div class="mini-stats"><div><span>Activos</span><b class="num">${compacto(D.balance.activo)}</b></div>
        <div><span>Deudas</span><b class="num">${compacto(D.balance.pasivo)}</b></div>
        <div><span>Patrimonio</span><b class="num">${compacto(D.balance.patrimonio)}</b></div></div>` : ''}
    </div>
    <div class="kpis">
      <div class="kpi"><div class="k">Ventas · ${E(r.mes.split(' ')[0].toLowerCase())}</div><div class="v num">${plano(r.ingresos)}</div>${previo ? delta(actual.ing, previo.ing) : ''}</div>
      <div class="kpi"><div class="k">Gastos y costos</div><div class="v num">${plano(r.gastos)}</div>${previo ? delta(actual.gas, previo.gas, true) : ''}</div>
      <div class="kpi"><div class="k">${r.resultado >= 0 ? 'Ganancia' : 'Pérdida'} del mes</div><div class="v num ${r.resultado >= 0 ? 'pos' : 'neg'}">${dinero(r.resultado) || '0.00'}</div>${previo ? delta(actual.ing - actual.gas, previo.ing - previo.gas) : ''}</div>
      <div class="kpi"><div class="k">Resultado del año</div><div class="v num ${r.anio >= 0 ? 'pos' : 'neg'}">${dinero(r.anio) || '0.00'}</div><span class="delta neutro">${b}</span></div>
    </div>
    <div class="seccion">Cuentas <button data-tab="cajas">Ver todo</button></div>
    <div class="lista">${D.cajas.filter(c => Math.abs(c.saldo) > 0.004).map(c => item({ ic: tipoCaja(c.nombre), t: E(c.nombre), v: `<span class="${c.saldo < 0 ? 'neg' : ''}">${plano(c.saldo)}</span>`, vs: c.moneda, tocar: 1, attr: `data-caja="${c.id}"` })).join('') || '<div class="vacio">Sin dinero anotado.</div>'}</div>
    <div class="seccion">Deudas</div>
    <div class="lista">
      ${item({ ic: 'entra', icc: 'verde', t: 'Me deben', s: `${D.cobrar.personas.length} persona(s)`, v: `USD ${plano(deb.USD)}`, vs: `CUP ${plano(deb.CUP)}`, tocar: 1, attr: 'data-ir-deudas="cobrar"' })}
      ${item({ ic: 'sale', icc: 'naranja', t: 'Debo', s: `${D.pagar.personas.length} persona(s)`, v: `USD ${plano(debo.USD)}`, vs: `CUP ${plano(debo.CUP)}`, tocar: 1, attr: 'data-ir-deudas="pagar"' })}
    </div>
    ${D.vencidas.length ? `<div class="seccion">Facturas vencidas</div><div class="lista">${D.vencidas.map(v => item({ ic: 'alerta', icc: 'rojo', t: E(v.tercero), s: `${v.tipo === 'cobrar' ? 'Me debe' : 'Debo'} · venció el ${fecha(v.vence)}`, v: `<span class="neg">${plano(v.pendiente)}</span>`, vs: v.moneda })).join('')}</div>` : ''}
    <div class="seccion">Ventas y gastos</div>
    <div class="card">${barras(g)}<div class="leyenda"><span><i style="background:var(--bar1)"></i>Ventas</span><span><i style="background:var(--bar2)"></i>Gastos y costos</span><span class="muted">· ${b}</span></div></div>
    ${top.length ? `<div class="seccion">En qué se fue el dinero este mes</div><div class="card">${top.map(x => `<div class="barra-h"><div class="fila"><span>${E(x.nombre)}</span><b class="num">${plano(x.v)}</b></div><div class="pista"><i style="width:${(x.v / maxTop * 100).toFixed(1)}%"></i></div></div>`).join('')}</div>` : ''}
    <div class="lista">${item({ ic: 'lista', icc: 'gris', t: 'Últimos movimientos', s: `${D.movimientos.length} más recientes`, tocar: 1, attr: 'data-ir="movimientos"' })}</div>
    <p class="solo-lectura">Solo lectura · para anotar, usa la Mac</p></main>`;
}

function vCajas() {
  const tot = { USD: 0, CUP: 0 };
  D.cajas.forEach(c => { tot[c.moneda] = (tot[c.moneda] || 0) + c.saldo; });
  return nav('Caja y bancos') + `<main>${encabezado('Caja y bancos')}
    <div class="kpis"><div class="kpi"><div class="k">Total en dólares</div><div class="v num">${plano(tot.USD)}</div><span class="delta neutro">USD</span></div>
      <div class="kpi"><div class="k">Total en pesos</div><div class="v num">${plano(tot.CUP)}</div><span class="delta neutro">CUP</span></div></div>
    <div class="lista">${D.cajas.map(c => item({ ic: tipoCaja(c.nombre), t: E(c.nombre),
      s: `<span class="pos">+${compacto(c.entra || 0)}</span> · <span class="neg">−${compacto(c.sale || 0)}</span> este mes`,
      v: `<span class="${c.saldo < 0 ? 'neg' : ''}">${plano(c.saldo)}</span>`, vs: c.moneda, tocar: 1, attr: `data-caja="${c.id}"` })).join('')}</div></main>`;
}

function porFecha(lista, fn) {
  const grupos = {};
  lista.forEach(x => { (grupos[x.fecha] = grupos[x.fecha] || []).push(x); });
  return Object.keys(grupos).sort().reverse().map(f => `<div class="seccion">${fechaLarga(f)}</div><div class="lista">${grupos[f].map(fn).join('')}</div>`).join('');
}

function vCaja() {
  const c = D.cajas.find(x => x.id === vista.id);
  if (!c) return vCajas();
  return nav(c.nombre, true) + `<main><h1 class="titulo-grande">${E(c.nombre)}</h1><p class="subtitulo">Movimientos desde el ${fecha(c.desde)}</p>
    <div class="card hero"><div class="etiqueta">Saldo</div><div class="cifra num ${c.saldo < 0 ? 'neg' : ''}">${plano(c.saldo)} <small>${c.moneda}</small></div>
      <div class="mini-stats"><div><span>Entró este mes</span><b class="num pos">${compacto(c.entra || 0)}</b></div><div><span>Salió este mes</span><b class="num neg">${compacto(c.sale || 0)}</b></div><div><span>Al empezar</span><b class="num">${compacto(c.inicial || 0)}</b></div></div></div>
    ${c.movs.length ? porFecha(c.movs, m => item({ ic: m.entra ? 'entra' : 'sale', icc: m.entra ? 'verde' : 'naranja', t: E(m.concepto), s: m.tercero ? E(m.tercero) : '',
      v: `<span class="${m.entra ? 'pos' : ''}">${m.entra ? '+' + plano(m.entra) : '−' + plano(m.sale)}</span>`, vs: `saldo ${plano(m.saldo)}` })) : '<div class="vacio">Sin movimientos.</div>'}</main>`;
}

function vDeudas() {
  const L = opciones.lado, X = D[L];
  return nav(L === 'cobrar' ? 'Me deben' : 'Debo') + `<main>${encabezado(L === 'cobrar' ? 'Me deben' : 'Debo')}
    <div class="seg"><button data-lado="cobrar" class="${L === 'cobrar' ? 'on' : ''}">Me deben</button><button data-lado="pagar" class="${L === 'pagar' ? 'on' : ''}">Debo</button></div>
    <div class="dos-cifras"><div class="card"><span>Total en USD</span><b class="num">${dinero(X.total.USD) || '–'}</b></div><div class="card"><span>Total en CUP</span><b class="num">${dinero(X.total.CUP) || '–'}</b></div></div>
    ${X.antiguedad ? `<div class="seccion">Antigüedad (${E(D.base)})</div><div class="card">${antiguedad(X.antiguedad) || '<div class="muted" style="font-size:13px">Sin deudas pendientes.</div>'}</div>` : ''}
    <div class="seccion">${L === 'cobrar' ? 'Clientes y personas' : 'Proveedores, personas e instituciones'}</div>
    <div class="lista">${X.personas.length ? X.personas.map(p => item({ ic: avatar(p.nombre), icc: L === 'cobrar' ? '' : 'naranja', t: E(p.nombre),
      s: `${E(p.tipo)}${p.vencidas ? ` · <span class="badge rojo">${p.vencidas} vencida${p.vencidas > 1 ? 's' : ''}</span>` : ''}`,
      v: [p.USD ? `USD ${plano(p.USD)}` : '', p.CUP ? `CUP ${plano(p.CUP)}` : ''].filter(Boolean)[0] || '–',
      vs: p.USD && p.CUP ? `CUP ${plano(p.CUP)}` : '', tocar: 1, attr: `data-persona="${p.id}"` })).join('')
      : `<div class="vacio">${L === 'cobrar' ? 'Nadie te debe ahora mismo.' : 'No debes nada ahora mismo.'}</div>`}</div></main>`;
}

function vPersona() {
  const L = vista.lado, p = D[L].personas.find(x => x.id === vista.id);
  if (!p) return vDeudas();
  const e = p.estado, T = e.tot;
  const fila = x => `<tr><td class="f">${fecha(x.fecha)}</td><td>${E(x.texto)}${x.vencida ? ' <span class="badge rojo">vencida</span>' : x.pagada ? ' <span class="badge verde">pagada</span>' : ''}</td>
    <td class="n ${x.importe < 0 ? 'neg' : ''}">${x.moneda === 'USD' ? dinero(x.importe) : ''}</td><td class="n ${x.importe < 0 ? 'neg' : ''}">${x.moneda === 'CUP' ? dinero(x.importe) : ''}</td></tr>`;
  return nav(p.nombre, true) + `<main><h1 class="titulo-grande">${E(p.nombre)}</h1><p class="subtitulo">${E(p.tipo)} · ${L === 'cobrar' ? 'cuenta por cobrar' : 'cuenta por pagar'}</p>
    <div class="dos-cifras" style="margin-bottom:14px"><div class="card"><span>${L === 'cobrar' ? 'Me debe' : 'Le debo'} en USD</span><b class="num">${dinero(T.USD.pendiente) || '–'}</b></div>
      <div class="card"><span>${L === 'cobrar' ? 'Me debe' : 'Le debo'} en CUP</span><b class="num">${dinero(T.CUP.pendiente) || '–'}</b></div></div>
    ${p.tramos && antiguedad(p.tramos) ? `<div class="card">${antiguedad(p.tramos)}</div>` : ''}
    <div class="seccion">Facturas</div>
    <div class="hoja-ec"><table><tr><th>Fecha</th><th>Factura</th><th class="n">USD</th><th class="n">CUP</th></tr>
      ${e.cargos.map(fila).join('') || '<tr><td colspan="4" class="vacio">Sin facturas.</td></tr>'}
      <tr class="total"><td colspan="2">Total</td><td class="n">${dinero(T.USD.total_cargos)}</td><td class="n">${dinero(T.CUP.total_cargos)}</td></tr>
      <tr class="pend"><td colspan="2">Pendiente</td><td class="n">${dinero(T.USD.pendiente) || '–'}</td><td class="n">${dinero(T.CUP.pendiente) || '–'}</td></tr></table></div>
    <div class="seccion">${L === 'cobrar' ? 'Pagos recibidos' : 'Pagos hechos'}</div>
    <div class="hoja-ec"><table><tr><th>Fecha</th><th>Detalle</th><th class="n">USD</th><th class="n">CUP</th></tr>
      ${e.pagos.map(fila).join('') || '<tr><td colspan="4" class="vacio">Sin pagos todavía.</td></tr>'}
      <tr class="total"><td colspan="2">Total</td><td class="n">${dinero(T.USD.pagos)}</td><td class="n">${dinero(T.CUP.pagos)}</td></tr></table></div></main>`;
}

function vInventario() {
  const I = D.inventario, maxV = Math.max(1, ...I.productos.map(p => p.valor));
  const gmax = Math.max(1, ...I.ganancias.map(g => Math.abs(g.ganancia)));
  return nav('Inventario') + `<main>${encabezado('Inventario')}
    <div class="card hero"><div class="etiqueta">Valor de la mercancía (a costo)</div><div class="cifra num">${plano(I.total)} <small>${D.base}</small></div>
      <div class="mini-stats"><div><span>Productos</span><b>${I.productos.length}</b></div><div><span>Poca existencia</span><b class="${I.productos.some(p => p.bajo) ? 'neg' : ''}">${I.productos.filter(p => p.bajo).length}</b></div><div><span>Agotados</span><b>${I.productos.filter(p => p.cantidad <= 0).length}</b></div></div></div>
    <div class="seccion">Productos</div>
    <div class="lista">${I.productos.length ? I.productos.map(p => `<div class="item tocar" data-producto="${p.id}"><span class="ic ${p.bajo || p.cantidad <= 0 ? 'rojo' : ''}">${ic('caja3d')}</span>
      <div class="t"><b>${E(p.nombre)} ${p.cantidad <= 0 ? '<span class="badge rojo">agotado</span>' : p.bajo ? '<span class="badge rojo">poco</span>' : ''}</b>
        <small>${plano(p.promedio)} por ${E(p.unidad)} · vale ${compacto(p.valor)}</small><div class="stock ${p.bajo ? 'bajo' : ''}"><i style="width:${(Math.max(0, p.valor) / maxV * 100).toFixed(1)}%"></i></div></div>
      <div class="val num">${num(p.cantidad)}<small>${E(unid(p.unidad, p.cantidad))}</small></div><span class="chev">${ic('der')}</span></div>`).join('') : '<div class="vacio">Sin productos.</div>'}</div>
    ${I.ganancias.length ? `<div class="seccion">Ganancia por producto · este año</div><div class="card">${I.ganancias.map(g => `<div class="barra-h"><div class="fila"><span>${E(g.nombre)} <span class="muted">· ${g.margen != null ? (g.margen * 100).toFixed(1) + '%' : ''}</span></span><b class="num ${g.ganancia < 0 ? 'neg' : 'pos'}">${dinero(g.ganancia)}</b></div><div class="pista"><i style="width:${(Math.abs(g.ganancia) / gmax * 100).toFixed(1)}%;background:${g.ganancia < 0 ? 'var(--neg)' : 'var(--pos)'}"></i></div></div>`).join('')}</div>` : ''}</main>`;
}

function vProducto() {
  const p = D.inventario.productos.find(x => x.id === vista.id);
  if (!p) return vInventario();
  const icono = t => /Venta/.test(t) ? ['sale', 'naranja'] : /Merma/.test(t) ? ['merma', 'rojo'] : /Costo extra/.test(t) ? ['costo', 'gris'] : ['entra', 'verde'];
  return nav(p.nombre, true) + `<main><h1 class="titulo-grande">${E(p.nombre)}</h1><p class="subtitulo">Se cuenta por ${E(p.unidad)}${p.minimo ? ` · mínimo ${num(p.minimo)}` : ''}</p>
    <div class="card hero"><div class="etiqueta">Quedan</div><div class="cifra num ${p.bajo || p.cantidad <= 0 ? 'neg' : ''}">${num(p.cantidad)} <small>${E(unid(p.unidad, p.cantidad))}</small></div>
      <div class="mini-stats"><div><span>Valen</span><b class="num">${compacto(p.valor)}</b></div><div><span>Costo por ${E(p.unidad)}</span><b class="num">${plano(p.promedio)}</b></div><div><span>Mínimo</span><b>${p.minimo ? num(p.minimo) : '–'}</b></div></div></div>
    <div class="seccion">Kárdex</div>
    ${p.kardex.length ? porFecha(p.kardex, m => { const [i, c] = icono(m.tipo); return item({ ic: i, icc: c, t: E(m.tipo),
      s: [m.nota ? E(m.nota) : '', m.venta != null ? `venta ${plano(m.venta)} · <span class="${m.ganancia < 0 ? 'neg' : 'pos'}">${m.ganancia >= 0 ? '+' : ''}${plano(m.ganancia)}</span>` : ''].filter(Boolean).join(' · '),
      v: m.cantidad ? `<span class="${m.cantidad > 0 ? 'pos' : ''}">${m.cantidad > 0 ? '+' : '−'}${num(Math.abs(m.cantidad))}</span>` : '<span class="muted">costo</span>', vs: `quedan ${num(m.quedan)}` }); })
      : '<div class="vacio">Sin movimientos.</div>'}</main>`;
}

function vEstados() {
  const P_ = opciones.periodo, S = opciones.estado, X = D.estados[P_];
  const neto = X.neto[X.neto.length - 1], prev = X.neto[X.neto.length - 2];
  return nav('Estados financieros', false, true) + `<main style="padding-top:12px">
    <div class="tikr-cab"><div class="emp"><div class="logo-mini">${E(iniciales(D.empresa))}</div><div><b>${E(D.empresa)}</b><small>Cifras en ${E(D.base)}${opciones.miles ? ' · miles' : ''}</small></div></div>
      <div class="px"><b class="num ${neto < 0 ? 'neg' : ''}">${plano(neto)}</b>${prev != null ? delta(neto, prev) : ''}<small style="display:block">Resultado neto · ${E(X.columnas[X.columnas.length - 1])}</small></div></div>
    <div class="pestanas">${[['resultados', 'Resultados'], ['balance', 'Balance'], ['flujo', 'Flujo de efectivo'], ['indicadores', 'Indicadores'], ['gastos', 'Gastos']].map(([k, t]) => `<button data-estado="${k}" class="${S === k ? 'on' : ''}">${t}</button>`).join('')}</div>
    <div class="fila-ctrl"><div class="seg tikr">${[['anual', 'Anual'], ['trimestral', 'Trimestral'], ['mensual', 'Mensual']].map(([k, t]) => `<button data-periodo="${k}" class="${P_ === k ? 'on' : ''}">${t}</button>`).join('')}</div>
      <button class="chip ${opciones.miles ? 'on' : ''}" data-accion="miles">Miles</button></div>
    ${tablaTikr(X[S])}
    <p class="pie-tabla">* ${{ anual: 'Anual', trimestral: 'Trimestral', mensual: 'Mensual' }[P_]} · desliza la tabla para ver más períodos · negativos en rojo entre paréntesis</p></main>`;
}

function vMovimientos() {
  return nav('Movimientos', true) + `<main><h1 class="titulo-grande">Movimientos</h1><p class="subtitulo">Los ${D.movimientos.length} más recientes</p>
    ${D.movimientos.length ? porFecha(D.movimientos, a => `<div class="item" style="display:block">
      <div style="display:flex;justify-content:space-between;gap:8px"><b style="font-size:15px">${E(a.concepto)}</b><span class="muted num" style="font-size:12px">n.º ${a.numero}</span></div>
      <small class="muted" style="font-size:12px">${E(a.tipo)}${a.por ? ' · ' + E(a.por) : ''}</small>
      <table style="width:100%;font-size:12.5px;margin-top:6px;border-collapse:collapse" class="num">${a.lineas.map(l => `<tr><td style="padding:2px 0;color:var(--text2)">${E(l.cuenta)}${l.tercero ? ' · ' + E(l.tercero) : ''}</td><td style="text-align:right;width:28%">${l.debe ? dinero(l.debe) : ''}</td><td style="text-align:right;width:28%">${l.haber ? dinero(l.haber) : ''}</td></tr>`).join('')}</table></div>`) : '<div class="vacio">Sin movimientos.</div>'}</main>`;
}

/* ---------- hoja de opciones ---------- */
function hojaOpciones() {
  const creado = new Date(D.creado);
  return `<div class="velo" data-accion="cerrar-hoja"><div class="hoja-op" data-no-cerrar>
    <div class="lista sin-icono"><div class="info">Datos del ${creado.toLocaleString('es')}${D.por ? ' · creado por ' + E(D.por) : ''}</div>
      <button class="item" data-accion="cargar">Cargar un archivo nuevo</button>
      <button class="item" data-accion="bloquear">Bloquear ahora</button>
      <button class="item rojo" data-accion="borrar">Borrar los datos de este teléfono</button></div>
    <div class="lista sin-icono"><button class="item cancelar" data-accion="cerrar-hoja">Cancelar</button></div></div></div>`;
}

/* ---------- pintar ---------- */
async function pintar() {
  if (!D) return pintarEntrar();
  const V = { inicio: vInicio, cajas: vCajas, caja: vCaja, deudas: vDeudas, persona: vPersona, inventario: vInventario,
              producto: vProducto, estados: vEstados, movimientos: vMovimientos }[vista.p] || vInicio;
  $app.innerHTML = V() + tabbar() + (hojaAbierta ? hojaOpciones() : '');
  document.querySelectorAll('.tikr').forEach(t => { t.scrollLeft = t.scrollWidth; });  // empieza por el período más reciente
  const n = document.querySelector('.nav'); if (n && !n.classList.contains('siempre')) n.classList.toggle('con-borde', window.scrollY > 34);
}

document.addEventListener('click', e => {
  if (hojaAbierta && e.target.closest('[data-no-cerrar]') && !e.target.closest('[data-accion]')) return;
  const t = e.target.closest('[data-accion],[data-tab],[data-caja],[data-persona],[data-producto],[data-lado],[data-periodo],[data-estado],[data-ir],[data-ir-deudas]');
  if (!t) return;
  const d = t.dataset;
  if (d.accion === 'abrir') abrir();
  else if (d.accion === 'cargar') { hojaAbierta = false; $archivo.click(); if (D) { D = null; pintar(); } }
  else if (d.accion === 'atras') atras();
  else if (d.accion === 'menu') { hojaAbierta = true; pintar(); }
  else if (d.accion === 'cerrar-hoja') { hojaAbierta = false; pintar(); }
  else if (d.accion === 'bloquear') bloquear();
  else if (d.accion === 'borrar') { if (confirm('¿Borrar el archivo guardado en este teléfono? (En la Mac no se borra nada.)')) borrar('archivo').then(() => { archivoPendiente = null; bloquear(); }); }
  else if (d.accion === 'miles') { opciones.miles = !opciones.miles; pintar(); }
  else if (d.tab) pestana(d.tab);
  else if (d.caja) ir('caja', { id: +d.caja });
  else if (d.persona) ir('persona', { id: +d.persona, lado: opciones.lado });
  else if (d.producto) ir('producto', { id: +d.producto });
  else if (d.lado) { opciones.lado = d.lado; pintar(); }
  else if (d.periodo) { opciones.periodo = d.periodo; pintar(); }
  else if (d.estado) { opciones.estado = d.estado; pintar(); }
  else if (d.irDeudas) { opciones.lado = d.irDeudas; pestana('deudas'); }
  else if (d.ir) ir(d.ir);
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
pintar();
