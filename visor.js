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
let fallos = 0, esperarHasta = 0, mensaje = '', archivoPendiente = null;
let opciones = { lado: 'cobrar', periodo: 'mensual', estado: 'resultados' };

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
const num = v => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const fecha = f => f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : '';
const unid = (u, c) => (Math.abs(c - 1) < 1e-9 || /s$/.test(u)) ? u : (/[lrnd]$/.test(u) ? u + 'es' : u + 's');
function valor(v, fm) {
  if (Array.isArray(v)) { fm = v[0]; v = v[1]; }
  if (v == null || v === '') return '';
  if (fm === 'p') return (v * 100).toFixed(1) + ' %';
  if (fm === 'r') return v.toFixed(2);
  if (fm === 'd') return Math.round(v) + ' días';
  if (fm === 'e') return String(v);
  if (fm === 't' || typeof v === 'string') return E(v);
  return dinero(v);
}
const esNeg = v => { if (Array.isArray(v)) v = v[1]; return typeof v === 'number' && v < -0.004; };

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
function bloquear() { D = null; pila = []; vista = { p: 'inicio' }; mensaje = ''; pintar(); }

document.addEventListener('visibilitychange', () => {
  if (document.hidden) ocultoDesde = Date.now();
  else if (ocultoDesde && Date.now() - ocultoDesde > BLOQUEO_MS && D) { mensaje = 'Se bloqueó por seguridad. Escribe la contraseña.'; bloquear(); }
});

/* ---------- pantalla de entrar ---------- */
async function pintarEntrar() {
  const hay = await leer('archivo');
  const tengoArchivo = !!(archivoPendiente || hay);
  $app.innerHTML = `<div class="entrar">
    <div class="logo">Σ</div>
    <h1>Mi Contabilidad</h1>
    <p>Visor para el teléfono · solo para ver · funciona sin internet</p>
    ${mensaje ? `<p class="error">${E(mensaje)}</p>` : ''}
    ${tengoArchivo ? `
      <p class="nota">${archivoPendiente ? 'Archivo nuevo elegido: ' + E(archivoPendiente.nombre) : 'Archivo guardado en este teléfono' + (hay && hay.nombre ? ': ' + E(hay.nombre) : '')}</p>
      <div class="campo"><input type="password" id="clave" placeholder="Contraseña del móvil" autocomplete="current-password" enterkeyhint="go"></div>
      <button class="boton" data-accion="abrir">Abrir</button>
      <button class="boton sec" data-accion="cargar">Cargar otro archivo</button>`
    : `<div class="hoja"><b>Para empezar:</b><ol style="margin:6px 0 0;padding-left:20px">
        <li>En la Mac: Más → <b>📱 Ver en el iPhone</b> → crea el archivo.</li>
        <li>Pásalo al iPhone por <b>AirDrop</b> y guárdalo en <b>Archivos</b>.</li>
        <li>Toca <b>Cargar archivo</b> y elígelo.</li></ol></div>
      <button class="boton" data-accion="cargar">Cargar archivo</button>`}
    <p class="nota" style="text-align:center">🔒 Los datos están cifrados con AES-256 y nunca salen de este teléfono.</p>
  </div>`;
  const c = document.getElementById('clave');
  if (c) { c.focus(); c.addEventListener('keydown', e => { if (e.key === 'Enter') abrir(); }); }
}

async function abrir() {
  const c = document.getElementById('clave');
  if (!c || !c.value) return;
  if (Date.now() < esperarHasta) { mensaje = `Demasiados intentos. Espera ${Math.ceil((esperarHasta - Date.now()) / 1000)} segundos.`; return pintar(); }
  const boton = document.querySelector('[data-accion="abrir"]');
  if (boton) { boton.textContent = 'Abriendo…'; boton.disabled = true; }
  const guardado = await leer('archivo');
  const fuente = archivoPendiente || guardado;
  try {
    D = await descifrar(fuente.texto, c.value);
    if (archivoPendiente) { await guardar('archivo', archivoPendiente); archivoPendiente = null; }
    fallos = 0; mensaje = ''; pila = []; vista = { p: 'inicio' };
  } catch (e) {
    if (e.message === 'archivo') { mensaje = 'Ese archivo no es de Mi Contabilidad. Crea uno en la Mac (Más → Ver en el iPhone).'; archivoPendiente = null; }
    else {
      fallos++;
      mensaje = 'Contraseña incorrecta.';
      if (fallos >= 5) { esperarHasta = Date.now() + 30000 * Math.pow(2, Math.floor(fallos / 5) - 1); mensaje += ' Espera un poco antes de volver a probar.'; }
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
function cabecera(titulo, conAtras) {
  return `<header class="cab">${conAtras ? '<button class="atras" data-accion="atras">‹ Atrás</button>' : ''}
    <h1>${E(titulo)}</h1><button class="icono-btn" data-accion="menu" aria-label="Opciones">⋯</button></header>`;
}
function bannerFoto() {
  const creado = new Date(D.creado);
  const dias = Math.floor((Date.now() - creado.getTime()) / 86400000);
  const txt = `Datos del ${creado.toLocaleDateString('es')} a las ${creado.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}`;
  return dias >= 3 ? `<p class="foto vieja">⚠ ${txt} (hace ${dias} días). Para verlos al día, crea un archivo nuevo en la Mac.</p>` : `<p class="foto">${txt}</p>`;
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
  return h + '</table></div>' + (inf.nota ? `<p class="nota">${E(inf.nota)}</p>` : '');
}
const iconoCaja = n => /Banco|Zelle|Tarjeta|exterior/i.test(n) ? '🏦' : '💵';
const nav = () => `<nav class="abajo">${[['inicio', '🏠', 'Inicio'], ['cajas', '💵', 'Caja'], ['deudas', '🧾', 'Deben/Debo'], ['inventario', '📦', 'Inventario'], ['estados', '📈', 'Estados']]
  .map(([p, i, t]) => `<button data-tab="${p}" class="${raiz() === p ? 'on' : ''}"><span>${i}</span>${t}</button>`).join('')}</nav>`;
function raiz() { const p = (pila[0] || vista).p; return ({ caja: 'cajas', persona: 'deudas', producto: 'inventario', movimientos: 'inicio' })[p] || p; }

/* ---------- pantallas ---------- */
function vInicio() {
  const r = D.resumen, b = D.base;
  const deb = D.cobrar.total, debo = D.pagar.total;
  const mx = Math.max(1, ...D.grafico.map(m => Math.max(m.ing, m.gas)));
  return cabecera(D.empresa) + `<main>${bannerFoto()}
    <div class="hoja"><span class="nota">Dinero disponible</span><div class="grande">${dinero(r.efectivo)} <small>${b}</small></div>
      ${D.tasa ? `<span class="nota">Tasa: ${num(D.tasa)} CUP = 1 USD</span>` : ''}
      ${D.cajas.filter(c => c.saldo).map(c => `<div class="fila tocar" data-caja="${c.id}"><span class="circulo">${iconoCaja(c.nombre)}</span>
        <div class="t"><b>${E(c.nombre)}</b></div><div class="v ${c.saldo < 0 ? 'neg' : ''}">${dinero(c.saldo)} <small>${c.moneda}</small></div><span class="flecha">›</span></div>`).join('')}</div>
    <div class="kpis">
      <div class="kpi"><span>Ventas de ${E(r.mes.split(' ')[0].toLowerCase())}</span><b>${dinero(r.ingresos)}</b></div>
      <div class="kpi"><span>Gastos y costos</span><b>${dinero(r.gastos)}</b></div>
      <div class="kpi ${r.resultado >= 0 ? 'bien' : 'mal'}"><span>${r.resultado >= 0 ? 'Ganancia' : 'Pérdida'} del mes</span><b>${dinero(r.resultado)}</b></div>
      <div class="kpi ${r.anio >= 0 ? 'bien' : 'mal'}"><span>En el año</span><b>${dinero(r.anio)}</b></div>
      <div class="kpi tocar" data-ir-deudas="cobrar"><span>Me deben</span><b class="chico">USD ${dinero(deb.USD)}</b><b class="chico">CUP ${dinero(deb.CUP)}</b></div>
      <div class="kpi tocar" data-ir-deudas="pagar"><span>Debo</span><b class="chico">USD ${dinero(debo.USD)}</b><b class="chico">CUP ${dinero(debo.CUP)}</b></div>
    </div>
    ${D.vencidas.length ? `<div class="hoja"><h2>⚠ Facturas vencidas</h2>${D.vencidas.map(v => `<div class="fila"><div class="t"><b>${E(v.tercero)}</b><small>${v.tipo === 'cobrar' ? 'Me debe' : 'Debo'} · ${E(v.concepto)} · venció ${fecha(v.vence)}</small></div><div class="v neg">${dinero(v.pendiente)} <small>${v.moneda}</small></div></div>`).join('')}</div>` : ''}
    <div class="hoja"><h2>Ventas y gastos — 12 meses</h2>
      <div class="grafico">${D.grafico.map(m => `<div class="m"><div class="bs"><i class="b-ing" style="height:${m.ing > 0 ? (m.ing / mx * 100).toFixed(1) : 0}%"></i><i class="b-gas" style="height:${m.gas > 0 ? (m.gas / mx * 100).toFixed(1) : 0}%"></i></div><span>${E(m.etq)}</span></div>`).join('')}</div>
      <p class="nota"><span class="pill">■ Ventas</span> <span class="pill" style="background:#fde3c8;color:#8a4b00">■ Gastos</span></p></div>
    ${D.top_gastos.length ? `<div class="hoja"><h2>Mayores gastos del mes</h2>${D.top_gastos.map(g => `<div class="fila"><div class="t">${E(g.nombre)}</div><div class="v">${dinero(g.v)}</div></div>`).join('')}</div>` : ''}
    <button class="boton sec" data-ir="movimientos">Ver los últimos movimientos</button>
    <p class="solo-lectura">Solo lectura · para anotar, usa la Mac</p></main>`;
}

function vCajas() {
  const tot = { USD: 0, CUP: 0 };
  D.cajas.forEach(c => { tot[c.moneda] = (tot[c.moneda] || 0) + c.saldo; });
  return cabecera('Caja y bancos') + `<main>${bannerFoto()}
    <div class="kpis"><div class="kpi"><span>Total en dólares</span><b>${dinero(tot.USD)}</b></div><div class="kpi"><span>Total en pesos</span><b>${dinero(tot.CUP)}</b></div></div>
    <div class="hoja">${D.cajas.map(c => `<div class="fila tocar" data-caja="${c.id}"><span class="circulo">${iconoCaja(c.nombre)}</span>
      <div class="t"><b>${E(c.nombre)}</b><small>Este mes: <span class="pos">+${dinero(c.entra) || '0'}</span> · <span class="neg">−${dinero(c.sale) || '0'}</span></small></div>
      <div class="v ${c.saldo < 0 ? 'neg' : ''}">${dinero(c.saldo) || '0.00'}<small>${c.moneda}</small></div><span class="flecha">›</span></div>`).join('')}</div></main>`;
}

function vCaja() {
  const c = D.cajas.find(x => x.id === vista.id);
  if (!c) return vCajas();
  return cabecera(c.nombre, true) + `<main>
    <div class="hoja"><span class="nota">Saldo</span><div class="grande ${c.saldo < 0 ? 'neg' : ''}">${dinero(c.saldo) || '0.00'} <small>${c.moneda}</small></div>
      <span class="nota">Este mes entró <b class="pos">${dinero(c.entra) || '0'}</b> y salió <b class="neg">${dinero(c.sale) || '0'}</b></span></div>
    <div class="hoja"><h2>Movimientos desde el ${fecha(c.desde)}</h2>
      ${c.movs.length ? c.movs.map(m => `<div class="fila"><div class="t"><b>${E(m.concepto)}</b><small>${fecha(m.fecha)}${m.tercero ? ' · ' + E(m.tercero) : ''}</small></div>
        <div class="v ${m.entra ? 'pos' : 'neg'}">${m.entra ? '+' + dinero(m.entra) : '−' + dinero(m.sale)}<small>saldo ${dinero(m.saldo) || '0'}</small></div></div>`).join('') : '<p class="vacio">Sin movimientos.</p>'}
      <p class="nota">Saldo al empezar: ${dinero(c.inicial) || '0'} ${c.moneda}</p></div></main>`;
}

function vDeudas() {
  const L = opciones.lado, X = D[L];
  return cabecera(L === 'cobrar' ? 'Me deben' : 'Debo') + `<main>
    <div class="seg verde"><button data-lado="cobrar" class="${L === 'cobrar' ? 'on' : ''}">Me deben</button><button data-lado="pagar" class="${L === 'pagar' ? 'on' : ''}">Debo</button></div>
    <div class="chips"><div class="chip-naranja"><span>Total en USD</span><b>${dinero(X.total.USD) || '–'}</b></div><div class="chip-naranja"><span>Total en CUP</span><b>${dinero(X.total.CUP) || '–'}</b></div></div>
    <div class="hoja">${X.personas.length ? X.personas.map(p => `<div class="fila tocar" data-persona="${p.id}"><span class="circulo">👤</span>
      <div class="t"><b>${E(p.nombre)}</b><small>${E(p.tipo)}${p.vencidas ? ` · <span class="pill rojo">${p.vencidas} vencida(s)</span>` : ''}</small></div>
      <div class="v">${p.USD ? 'USD ' + dinero(p.USD) : ''}${p.USD && p.CUP ? '<br>' : ''}${p.CUP ? 'CUP ' + dinero(p.CUP) : ''}</div><span class="flecha">›</span></div>`).join('')
      : `<p class="vacio">${L === 'cobrar' ? 'Nadie te debe ahora mismo.' : 'No debes nada ahora mismo.'}</p>`}</div></main>`;
}

function vPersona() {
  const L = vista.lado, p = D[L].personas.find(x => x.id === vista.id);
  if (!p) return vDeudas();
  const e = p.estado, T = e.tot;
  const fila = (x, pagos) => `<tr><td class="f">${fecha(x.fecha)}</td><td>${E(x.texto)}${x.vencida ? ' <span class="pill rojo">vencida</span>' : x.pagada ? ' <span class="pill ok">pagada</span>' : ''}</td>
    <td class="n ${x.importe < 0 ? 'neg' : ''}">${x.moneda === 'USD' ? dinero(x.importe) : ''}</td><td class="n ${x.importe < 0 ? 'neg' : ''}">${x.moneda === 'CUP' ? dinero(x.importe) : ''}</td></tr>`;
  return cabecera(p.nombre, true) + `<main>
    <div class="chips"><div class="chip-naranja"><span>${L === 'cobrar' ? 'Me debe' : 'Le debo'} en USD</span><b>${dinero(T.USD.pendiente) || '–'}</b></div>
      <div class="chip-naranja"><span>${L === 'cobrar' ? 'Me debe' : 'Le debo'} en CUP</span><b>${dinero(T.CUP.pendiente) || '–'}</b></div></div>
    <div class="hoja"><h2>Facturas</h2><table class="ec"><tr><th>Fecha</th><th>Factura</th><th class="n">USD</th><th class="n">CUP</th></tr>
      ${e.cargos.map(x => fila(x)).join('') || '<tr><td colspan="4" class="vacio">Sin facturas.</td></tr>'}
      <tr class="total"><td colspan="2">Total</td><td class="n">${dinero(T.USD.total_cargos)}</td><td class="n">${dinero(T.CUP.total_cargos)}</td></tr>
      <tr class="pend"><td colspan="2">Pendiente</td><td class="n">${dinero(T.USD.pendiente) || '–'}</td><td class="n">${dinero(T.CUP.pendiente) || '–'}</td></tr></table></div>
    <div class="hoja"><h2>${L === 'cobrar' ? 'Pagos recibidos' : 'Pagos hechos'}</h2><table class="ec"><tr><th>Fecha</th><th>Detalle</th><th class="n">USD</th><th class="n">CUP</th></tr>
      ${e.pagos.map(x => fila(x)).join('') || '<tr><td colspan="4" class="vacio">Sin pagos todavía.</td></tr>'}
      <tr class="total"><td colspan="2">Total</td><td class="n">${dinero(T.USD.pagos)}</td><td class="n">${dinero(T.CUP.pagos)}</td></tr></table></div></main>`;
}

function vInventario() {
  const I = D.inventario;
  return cabecera('Inventario') + `<main>${bannerFoto()}
    <div class="hoja"><span class="nota">Toda la mercancía vale</span><div class="grande">${dinero(I.total) || '0.00'} <small>${D.base}</small></div></div>
    <div class="hoja">${I.productos.length ? I.productos.map(p => `<div class="fila tocar" data-producto="${p.id}"><span class="circulo">📦</span>
      <div class="t"><b>${E(p.nombre)}</b><small>vale ${dinero(p.valor) || '0'} · ${dinero(p.promedio)} por ${E(p.unidad)}${p.bajo ? ' · <span class="pill rojo">poco</span>' : ''}${p.cantidad <= 0 ? ' · <span class="pill rojo">agotado</span>' : ''}</small></div>
      <div class="v">${num(p.cantidad)}<small>${E(unid(p.unidad, p.cantidad))}</small></div><span class="flecha">›</span></div>`).join('') : '<p class="vacio">Sin productos.</p>'}</div>
    ${I.ganancias.length ? `<div class="hoja"><h2>Ganancia por producto (este año)</h2>${I.ganancias.map(g => `<div class="fila"><div class="t"><b>${E(g.nombre)}</b><small>vendido ${num(g.cant)} ${E(unid(g.unidad, g.cant))} · ventas ${dinero(g.venta)}</small></div>
      <div class="v ${g.ganancia < 0 ? 'neg' : 'pos'}">${dinero(g.ganancia)}<small>${g.margen != null ? (g.margen * 100).toFixed(1) + ' %' : ''}</small></div></div>`).join('')}</div>` : ''}</main>`;
}

function vProducto() {
  const p = D.inventario.productos.find(x => x.id === vista.id);
  if (!p) return vInventario();
  return cabecera(p.nombre, true) + `<main>
    <div class="kpis"><div class="kpi ${p.bajo || p.cantidad <= 0 ? 'mal' : ''}"><span>Quedan</span><b>${num(p.cantidad)} ${E(unid(p.unidad, p.cantidad))}</b></div>
      <div class="kpi"><span>Valen</span><b>${dinero(p.valor) || '0.00'}</b></div>
      <div class="kpi"><span>Costo por ${E(p.unidad)}</span><b>${dinero(p.promedio)}</b></div>
      ${p.minimo ? `<div class="kpi"><span>Mínimo</span><b>${num(p.minimo)}</b></div>` : ''}</div>
    <div class="hoja"><h2>Movimientos (kárdex)</h2>${p.kardex.map(m => `<div class="fila"><div class="t"><b>${E(m.tipo)}</b><small>${fecha(m.fecha)}${m.nota ? ' · ' + E(m.nota) : ''}${m.venta != null ? ` · venta ${dinero(m.venta)} (<span class="${m.ganancia < 0 ? 'neg' : 'pos'}">${m.ganancia >= 0 ? '+' : ''}${dinero(m.ganancia)}</span>)` : ''}</small></div>
      <div class="v ${m.cantidad < 0 ? 'neg' : m.cantidad > 0 ? 'pos' : ''}">${m.cantidad ? (m.cantidad > 0 ? '+' : '−') + num(Math.abs(m.cantidad)) : 'costo'}<small>quedan ${num(m.quedan)}</small></div></div>`).join('') || '<p class="vacio">Sin movimientos.</p>'}</div></main>`;
}

function vEstados() {
  const P = opciones.periodo, S = opciones.estado, X = D.estados[P];
  const neto = X.neto[X.neto.length - 1], prev = X.neto[X.neto.length - 2];
  const cambio = prev && Math.abs(prev) > 0.004 ? (neto - prev) / Math.abs(prev) : null;
  return cabecera('Estados financieros') + `<main>${bannerFoto()}
    <div class="hoja"><span class="nota">Resultado neto · ${E(X.columnas[X.columnas.length - 1])}</span>
      <div class="grande ${neto < 0 ? 'neg' : ''}">${dinero(neto) || '0.00'} <small>${D.base}</small></div>
      ${cambio != null ? `<span class="${cambio >= 0 ? 'pos' : 'neg'}" style="font-weight:700">${cambio >= 0 ? '+' : ''}${(cambio * 100).toFixed(1)} % vs. período anterior</span>` : ''}</div>
    <div class="seg">${[['anual', 'Anual'], ['trimestral', 'Trimestral'], ['mensual', 'Mensual']].map(([k, t]) => `<button data-periodo="${k}" class="${P === k ? 'on' : ''}">${t}</button>`).join('')}</div>
    <div class="seg verde">${[['resultados', 'Resultados'], ['balance', 'Balance'], ['flujo', 'Flujo'], ['indicadores', 'Indicadores'], ['gastos', 'Gastos']].map(([k, t]) => `<button data-estado="${k}" class="${S === k ? 'on' : ''}">${t}</button>`).join('')}</div>
    ${tablaTikr(X[S])}
    <p class="nota">Desliza la tabla hacia la izquierda para ver más columnas. Cifras en ${D.base}.</p></main>`;
}

function vMovimientos() {
  return cabecera('Últimos movimientos', true) + `<main>${D.movimientos.map(a => `<div class="hoja">
    <div class="fila" style="padding-top:0"><div class="t"><b>${E(a.concepto)}</b><small>n.º ${a.numero} · ${fecha(a.fecha)} · ${E(a.tipo)}${a.por ? ' · ' + E(a.por) : ''}</small></div></div>
    <table class="ec">${a.lineas.map(l => `<tr><td>${E(l.cuenta)}${l.tercero ? ' <small>· ' + E(l.tercero) + '</small>' : ''}</td><td class="n">${l.debe ? dinero(l.debe) : ''}</td><td class="n">${l.haber ? dinero(l.haber) : ''}</td></tr>`).join('')}</table></div>`).join('') || '<p class="vacio">Sin movimientos.</p>'}</main>`;
}

/* ---------- pintar ---------- */
async function pintar() {
  if (!D) return pintarEntrar();
  const V = { inicio: vInicio, cajas: vCajas, caja: vCaja, deudas: vDeudas, persona: vPersona, inventario: vInventario,
              producto: vProducto, estados: vEstados, movimientos: vMovimientos }[vista.p] || vInicio;
  $app.innerHTML = V() + nav();
  // en el teléfono, las tablas empiezan mostrando el período más reciente (a la derecha)
  document.querySelectorAll('.tikr').forEach(t => { t.scrollLeft = t.scrollWidth; });
}

function menu() {
  const op = prompt('Opciones:\n1 = Cargar un archivo nuevo\n2 = Bloquear ahora\n3 = Borrar los datos de este teléfono\n\nEscribe el número:');
  if (op === '1') { D = null; $archivo.click(); pintar(); }
  else if (op === '2') bloquear();
  else if (op === '3' && confirm('¿Borrar el archivo guardado en este teléfono? (En la Mac no se borra nada.)')) { borrar('archivo').then(() => { archivoPendiente = null; bloquear(); }); }
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-accion],[data-tab],[data-caja],[data-persona],[data-producto],[data-lado],[data-periodo],[data-estado],[data-ir],[data-ir-deudas]');
  if (!t) return;
  const d = t.dataset;
  if (d.accion === 'abrir') abrir();
  else if (d.accion === 'cargar') $archivo.click();
  else if (d.accion === 'atras') atras();
  else if (d.accion === 'menu') menu();
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
