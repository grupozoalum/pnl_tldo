/* =====================================================================
   PANEL DE ADMINISTRACIÓN · FRACCIONAMIENTO
   Firebase v10 (SDK modular vía CDN) · JavaScript ES6+ sin frameworks
   ===================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAnalytics, isSupported } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js";
import {
  getAuth,
  initializeAuth,
  inMemoryPersistence,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  doc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  Timestamp,
  arrayUnion,
  arrayRemove
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ---------------------------------------------------------------------
   1. INICIALIZACIÓN DE FIREBASE
   --------------------------------------------------------------------- */
const firebaseConfig = {
  apiKey: "AIzaSyCNWsowcsixY7I4JDuOzoQfu3Jdx9UFGNQ",
  authDomain: "doc-con-ia.firebaseapp.com",
  projectId: "doc-con-ia",
  storageBucket: "doc-con-ia.firebasestorage.app",
  messagingSenderId: "952895131866",
  appId: "1:952895131866:web:edd126a29c7f11e41295e3",
  measurementId: "G-HWWWE5FW7N"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Instancia secundaria SOLO para crear cuentas de residentes.
// createUserWithEmailAndPassword inicia sesión con la cuenta nueva; hacerlo aquí
// evita que el administrador pierda su propia sesión en el panel.
const appAltas = initializeApp(firebaseConfig, "altas-residentes");
const authAltas = initializeAuth(appAltas, { persistence: inMemoryPersistence });
isSupported().then((ok) => ok && getAnalytics(app)).catch(() => {});

/* ---------------------------------------------------------------------
   2. CONFIGURACIÓN DEL PANEL
   --------------------------------------------------------------------- */
const COL = {
  casas: "casas",
  usuarios: "usuarios",       // perfil de cada cuenta del portal: rol + casa
  comunicados: "comunicados",
  reservaciones: "reservaciones",
  incidencias: "incidencias",
  accesos: "accesos_qr",
  // Colecciones que escribe la App de Seguridad (caseta)
  incidenciasSeguridad: "incidencias_seguridad",
  accesosRegistrados: "accesos_registrados"
};

const CONFIG = {
  adminUid: "FLoE6Q9e0xSWgpCu2N1zMd9rP5y2", // único usuario autorizado para entrar al panel
  campoFecha: "fecha",      // campo de fecha/hora que guardan las apps (serverTimestamp)
  limiteSeguridad: 100,     // últimos N registros de incidencias / accesos en tiempo real
  requiereLogin: true       // ponlo en false solo para pruebas locales
};

/* ---------------------------------------------------------------------
   3. ESTADO
   --------------------------------------------------------------------- */
const state = {
  user: null,
  casas: [],
  comunicados: [],
  reservaciones: [],
  incidencias: [],
  accesos: [],
  cargado: { casas: false, comunicados: false, reservaciones: false, incidencias: false, accesos: false },
  filtros: {
    pagosTexto: "",
    pagosEstatus: "todos",
    pagosPrivada: "",
    pagosFase: "",
    comunicados: "todos",
    reservas: "pendiente",
    seguridad: "incidencias",
    seguridadTexto: ""
  },
  vistos: {},
  unsubs: [],
  lightbox: { fotos: [], i: 0, titulo: "" }
};

/* ---------------------------------------------------------------------
   4. UTILIDADES
   --------------------------------------------------------------------- */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const icon = (name, cls = "icon") => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

/** Devuelve el primer valor no vacío entre varias posibles llaves (tolerante a esquemas distintos). */
const pick = (obj, keys, def = "") => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return def;
};

const pad = (n) => String(n).padStart(2, "0");

function toDate(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v === "object" && "seconds" in v) return new Date(v.seconds * 1000);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split("-").map(Number);
    return new Date(y, m - 1, d); // fecha local, sin desfase de zona horaria
  }
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

const CAMPOS_FECHA = () => [...new Set([CONFIG.campoFecha, "fecha", "creadoEn", "createdAt", "timestamp", "fechaHora", "fechaRegistro", "hora"])];

function fechaDoc(o) {
  for (const k of CAMPOS_FECHA()) {
    const d = toDate(o?.[k]);
    if (d) return d;
  }
  return null;
}

const fmtFecha = (d, conHora = true) =>
  d
    ? new Intl.DateTimeFormat("es-MX", conHora ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "long" }).format(d)
    : "—";

const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
function tiempoRelativo(d) {
  if (!d) return "Sin fecha";
  const seg = Math.round((d.getTime() - Date.now()) / 1000);
  const abs = Math.abs(seg);
  if (abs < 60) return rtf.format(seg, "second");
  if (abs < 3600) return rtf.format(Math.round(seg / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(seg / 3600), "hour");
  if (abs < 604800) return rtf.format(Math.round(seg / 86400), "day");
  return fmtFecha(d);
}

const ordenarDesc = (arr) => arr.sort((a, b) => (fechaDoc(b)?.getTime() || 0) - (fechaDoc(a)?.getTime() || 0));

const mapDocs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));

const esUrlImagen = (u) => typeof u === "string" && (/^https?:\/\//i.test(u) || /^data:image\//i.test(u));

function obtenerFotos(o) {
  const out = [];
  for (const k of ["fotos", "imagenes", "evidencias", "fotosUrls", "urls", "photos"]) {
    if (Array.isArray(o?.[k])) {
      o[k].forEach((x) => {
        const u = typeof x === "string" ? x : x?.url || x?.downloadURL || x?.src;
        if (esUrlImagen(u)) out.push(u);
      });
    }
  }
  for (const k of ["fotoUrl", "foto", "fotoURL", "imagen", "imagenUrl", "urlFoto", "photoURL", "photoUrl", "evidencia", "url"]) {
    if (esUrlImagen(o?.[k])) out.push(o[k]);
  }
  return [...new Set(out)];
}

const normalizar = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const emailAdmin = () => state.user?.email || state.user?.uid || "admin";

const badge = (texto, tipo = "neutral") => `<span class="badge badge--${tipo}">${esc(texto)}</span>`;

const vacio = (texto, ic = "check") => `<li class="empty">${icon(ic)}<span>${esc(texto)}</span></li>`;
const vacioGrid = (texto, ic = "check") => `<div class="empty">${icon(ic)}<span>${esc(texto)}</span></div>`;
const skeletons = (n = 3) => Array.from({ length: n }, () => `<div class="skeleton"></div>`).join("");

async function conCarga(btn, fn) {
  if (btn) {
    btn.disabled = true;
    btn.classList.add("is-loading");
  }
  try {
    return await fn();
  } finally {
    if (btn && btn.isConnected) {
      btn.disabled = false;
      btn.classList.remove("is-loading");
    }
  }
}

function manejarError(contexto, err) {
  console.error(`[${contexto}]`, err);
  const msg =
    err?.code === "permission-denied"
      ? `Sin permisos para ${contexto}. Revisa las reglas de Firestore.`
      : err?.code === "unavailable"
        ? "Sin conexión con el servidor. Reintentando…"
        : `Error en ${contexto}: ${err?.message || "desconocido"}`;
  toast(msg, "error", 6000);
}

/* ---------------------------------------------------------------------
   5. NORMALIZADORES DE DOMINIO
   --------------------------------------------------------------------- */
// Casas
const numeroCasa = (c) => pick(c, ["numero", "numeroCasa", "casa", "lote", "vivienda"], c.id);
const propietario = (c) => pick(c, ["propietario", "residente", "nombre", "titular"], "Sin registrar");
const calleCasa = (c) => pick(c, ["calle", "direccion", "manzana", "privada"], "");
const MAX_PERSONAS = 4;
const faseTexto = (f) => (f === undefined || f === null || f === "" ? "" : /^\d/.test(String(f)) ? `Fase ${f}` : String(f));
const ubicacionCasa = (c) => [c.privada, faseTexto(c.fase)].filter(Boolean).join(" · ");
const etiquetaCompleta = (c) => [`Casa ${numeroCasa(c)}`, c.privada, faseTexto(c.fase)].filter(Boolean).join(" · ");
const titularesDe = (c) => (Array.isArray(c.titulares) && c.titulares.length ? c.titulares : c.propietario ? [{ nombre: c.propietario }] : []);
const inquilinosDe = (c) => (c.tieneInquilinos && Array.isArray(c.inquilinos) ? c.inquilinos : []);
const ordenCasa = (c) => `${String(c.fase ?? "").padStart(4, "0")}|${normalizar(c.privada)}|${String(numeroCasa(c)).padStart(6, "0")}`;
const campoEstatusCasa = (c) => ("estatusPago" in c ? "estatusPago" : "estatus" in c ? "estatus" : "estado" in c ? "estado" : "estatusPago");

function estaPagada(c) {
  const v = pick(c, ["estatusPago", "estatus", "estado"], c.pagado);
  if (typeof v === "boolean") return v;
  return /^pagad/i.test(String(v ?? "").trim());
}

// Reservaciones
const campoEstatusReserva = (r) => ("estado" in r && !("estatus" in r) ? "estado" : "estatus");
function estatusReserva(r) {
  const e = normalizar(pick(r, ["estatus", "estado"], "pendiente"));
  if (/aprob|acept|confirm/.test(e)) return "aprobada";
  if (/deneg|rechaz|cancel/.test(e)) return "denegada";
  return "pendiente";
}
const amenidadDe = (r) => pick(r, ["amenidad", "instalacion", "espacio", "area", "lugar"], "Amenidad");
const residenteDe = (r) => pick(r, ["residente", "nombre", "solicitante", "nombreResidente", "usuario"], "Residente");
const etiquetaCasa = (v) => (/^\d/.test(String(v)) ? `Casa ${v}` : String(v));
const casaDe = (r) => pick(r, ["casa", "numeroCasa", "vivienda", "lote", "domicilio"], "—");
const diaReserva = (r) => pick(r, ["fechaReserva", "fechaEvento", "dia", "fechaUso"], null) ?? r.fecha ?? null;
const horaIni = (r) => pick(r, ["horaInicio", "inicio", "desde"], "");
const horaFin = (r) => pick(r, ["horaFin", "fin", "hasta"], "");

function claveDia(v) {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = toDate(v);
  return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : "";
}
const minutos = (h) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(h || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

function conflictos(r) {
  const dia = claveDia(diaReserva(r));
  if (!dia) return [];
  const a1 = minutos(horaIni(r));
  const a2 = minutos(horaFin(r));
  return state.reservaciones.filter((o) => {
    if (o.id === r.id || estatusReserva(o) !== "aprobada") return false;
    if (normalizar(amenidadDe(o)) !== normalizar(amenidadDe(r))) return false;
    if (claveDia(diaReserva(o)) !== dia) return false;
    const b1 = minutos(horaIni(o));
    const b2 = minutos(horaFin(o));
    if ([a1, a2, b1, b2].some((x) => x === null)) return true; // sin horario: mismo día cuenta como empalme
    return a1 < b2 && b1 < a2;
  });
}

// Incidencias / accesos
const incidenciaAtendida = (i) => /atend|resuel|cerrad|solucion/.test(normalizar(pick(i, ["estatus", "estado"], "")));
const guardiaDe = (o) => pick(o, ["guardia", "reportadoPor", "nombreGuardia", "autor", "registradoPor"], "Guardia no especificado");

/* ---------------------------------------------------------------------
   6. UI: TOASTS, MODAL, LIGHTBOX
   --------------------------------------------------------------------- */
function toast(msg, tipo = "info", ms = 4000) {
  const iconos = { success: "check", error: "alert", warning: "alert", info: "shield" };
  const el = document.createElement("div");
  el.className = `toast toast--${tipo}`;
  el.setAttribute("role", tipo === "error" ? "alert" : "status");
  el.innerHTML = `${icon(iconos[tipo] || "shield")}<span>${esc(msg)}</span>`;
  $("#toasts").append(el);
  requestAnimationFrame(() => el.classList.add("is-visible"));
  setTimeout(() => {
    el.classList.remove("is-visible");
    setTimeout(() => el.remove(), 300);
  }, ms);
}

let modalResolver = null;
let focoPrevio = null;

/**
 * Abre el modal genérico. Devuelve una promesa con { ok, datos }.
 * Si el cuerpo contiene campos con `name`, se devuelven en `datos`.
 */
function abrirModal({ titulo, html, confirmar = "Aceptar", cancelar = "Cancelar", tipo = "primary", soloLectura = false, ancho = false, conservar = false }) {
  focoPrevio = document.activeElement;
  $("#modal-title").textContent = titulo;
  if (!conservar) $("#modal-body").innerHTML = html;
  $("#modal-form").classList.toggle("modal__panel--wide", ancho);
  const ok = $("#modal-confirm");
  ok.textContent = confirmar;
  ok.className = `btn btn--${tipo}`;
  ok.hidden = soloLectura;
  $("#modal-cancel").textContent = soloLectura ? "Cerrar" : cancelar;
  $("#modal").hidden = false;
  document.body.classList.add("no-scroll");
  if (!conservar) setTimeout(() => ($("#modal-body").querySelector("input, textarea, select") || $("#modal-cancel")).focus(), 60);
  return new Promise((resolve) => (modalResolver = resolve));
}

function cerrarModal(resultado = { ok: false, datos: {} }) {
  $("#modal").hidden = true;
  document.body.classList.remove("no-scroll");
  if (modalResolver) {
    const r = modalResolver;
    modalResolver = null;
    r(resultado);
  }
  focoPrevio?.focus?.();
}

$("#modal-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const datos = {};
  $$("#modal-body [name]").forEach((el) => (datos[el.name] = el.value.trim()));
  cerrarModal({ ok: true, datos });
});
$$("#modal [data-close]").forEach((el) => el.addEventListener("click", () => cerrarModal()));

function detalleHTML(obj) {
  const etiqueta = (k) =>
    k
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .replace(/^\w/, (c) => c.toUpperCase());

  const valor = (v) => {
    if (v === null || v === undefined || v === "") return "—";
    if (typeof v === "boolean") return v ? "Sí" : "No";
    if (typeof v?.toDate === "function" || v instanceof Date) return fmtFecha(toDate(v));
    if (Array.isArray(v)) {
      if (v.every((x) => esUrlImagen(typeof x === "string" ? x : x?.url))) return `${v.length} fotografía(s)`;
      return v.map((x) => (x && typeof x === "object" ? (x.nombre ? `${x.nombre}${x.email ? ` (${x.email})` : ""}` : JSON.stringify(x)) : x)).join(", ");
    }
    if (typeof v === "object") {
      if ("latitude" in v && "longitude" in v) return `${v.latitude.toFixed(5)}, ${v.longitude.toFixed(5)}`;
      return JSON.stringify(v);
    }
    if (esUrlImagen(v)) return "Fotografía adjunta";
    return String(v);
  };

  const filas = Object.keys(obj)
    .filter((k) => k !== "id" && !k.startsWith("_"))
    .sort((a, b) => a.localeCompare(b, "es"))
    .map((k) => `<div class="detail__row"><dt>${esc(etiqueta(k))}</dt><dd>${esc(valor(obj[k]))}</dd></div>`)
    .join("");

  const fotos = obtenerFotos(obj);
  const thumbs = fotos.length
    ? `<div class="thumbs">${fotos
        .map((u, i) => `<button type="button" data-thumb="${i}" aria-label="Ver fotografía ${i + 1}"><img src="${esc(u)}" alt="" loading="lazy"></button>`)
        .join("")}</div>`
    : "";

  return `<dl class="detail">${filas || '<div class="detail__row"><dd>Sin información</dd></div>'}</dl>${thumbs}`;
}

async function verDetalle(col, id) {
  const item = buscar(col, id);
  if (!item) return;
  const titulos = { casas: "Detalle de vivienda", reservaciones: "Detalle de reservación", incidencias: "Detalle de incidencia", accesos: "Detalle de acceso QR", comunicados: "Detalle de publicación" };
  const promesa = abrirModal({ titulo: titulos[col] || "Detalle", html: detalleHTML(item), soloLectura: true });
  const fotos = obtenerFotos(item);
  $$("#modal-body [data-thumb]").forEach((b) =>
    b.addEventListener("click", () => abrirLightbox(fotos, Number(b.dataset.thumb), titulos[col]))
  );
  await promesa;
}

// Lightbox
function abrirLightbox(fotos, i = 0, titulo = "") {
  if (!fotos.length) return;
  state.lightbox = { fotos, i, titulo };
  pintarLightbox();
  $("#lightbox").hidden = false;
  document.body.classList.add("no-scroll");
}
function pintarLightbox() {
  const { fotos, i, titulo } = state.lightbox;
  $("#lightbox-img").src = fotos[i];
  $("#lightbox-cap").textContent = `${titulo ? titulo + " · " : ""}${i + 1} de ${fotos.length}`;
  const multiples = fotos.length > 1;
  $$("#lightbox .lightbox__nav").forEach((b) => (b.hidden = !multiples));
}
function moverLightbox(paso) {
  const lb = state.lightbox;
  lb.i = (lb.i + paso + lb.fotos.length) % lb.fotos.length;
  pintarLightbox();
}
function cerrarLightbox() {
  $("#lightbox").hidden = true;
  $("#lightbox-img").removeAttribute("src");
  if ($("#modal").hidden) document.body.classList.remove("no-scroll");
}
$("#lightbox").addEventListener("click", (e) => {
  const accion = e.target.closest("[data-lb]")?.dataset.lb;
  if (accion === "cerrar" || e.target.id === "lightbox") cerrarLightbox();
  if (accion === "prev") moverLightbox(-1);
  if (accion === "next") moverLightbox(1);
});
let toqueX = null;
$("#lightbox").addEventListener("touchstart", (e) => (toqueX = e.touches[0].clientX), { passive: true });
$("#lightbox").addEventListener("touchend", (e) => {
  if (toqueX === null) return;
  const dx = e.changedTouches[0].clientX - toqueX;
  if (Math.abs(dx) > 50 && state.lightbox.fotos.length > 1) moverLightbox(dx < 0 ? 1 : -1);
  toqueX = null;
});

/* ---------------------------------------------------------------------
   7. NAVEGACIÓN Y SIDEBAR
   --------------------------------------------------------------------- */
const TITULOS = {
  resumen: "Resumen",
  pagos: "Casas y pagos",
  comunicados: "Comunicación",
  amenidades: "Amenidades",
  seguridad: "Seguridad"
};

function irA(seccion) {
  if (!TITULOS[seccion]) seccion = "resumen";
  $$(".section").forEach((s) => (s.hidden = s.id !== `sec-${seccion}`));
  $$(".nav__item").forEach((b) => {
    const activo = b.dataset.section === seccion;
    b.classList.toggle("is-active", activo);
    b.setAttribute("aria-current", activo ? "page" : "false");
  });
  $("#section-title").textContent = TITULOS[seccion];
  document.title = `${TITULOS[seccion]} · Panel de Administración`;
  history.replaceState(null, "", `#${seccion}`);
  sidebar(false);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function sidebar(abrir) {
  const sb = $("#sidebar");
  sb.classList.toggle("is-open", abrir);
  $("#overlay").hidden = !abrir;
  $(".topbar__menu")?.setAttribute("aria-expanded", String(abrir));
  if (window.innerWidth < 1024) document.body.classList.toggle("no-scroll", abrir);
}

$$(".nav__item").forEach((b) => b.addEventListener("click", () => irA(b.dataset.section)));
$$("[data-sidebar]").forEach((el) => el.addEventListener("click", () => sidebar(el.dataset.sidebar === "abrir")));
window.addEventListener("resize", () => {
  if (window.innerWidth >= 1024 && $("#sidebar").classList.contains("is-open")) sidebar(false);
});

document.addEventListener("keydown", (e) => {
  if (!$("#lightbox").hidden) {
    if (e.key === "Escape") cerrarLightbox();
    if (e.key === "ArrowRight") moverLightbox(1);
    if (e.key === "ArrowLeft") moverLightbox(-1);
    return;
  }
  if (e.key === "Escape") {
    if (!$("#modal").hidden) cerrarModal();
    else if ($("#sidebar").classList.contains("is-open")) sidebar(false);
  }
});

// Fecha en topbar y estado de conexión
$("#topbar-date").textContent = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());

function actualizarConexion() {
  const pill = $("#estado-conexion");
  const online = navigator.onLine;
  pill.classList.toggle("is-offline", !online);
  $(".live-pill__text", pill).textContent = online ? "En vivo" : "Sin conexión";
  pill.title = online ? "Sincronizado en tiempo real con Firestore" : "Sin conexión: los cambios se enviarán al reconectar";
}
window.addEventListener("online", () => { actualizarConexion(); toast("Conexión restablecida", "success"); });
window.addEventListener("offline", () => { actualizarConexion(); toast("Sin conexión a internet", "warning"); });
actualizarConexion();

/* ---------------------------------------------------------------------
   8. AUTENTICACIÓN
   --------------------------------------------------------------------- */
function mostrarLogin() {
  $("#boot").hidden = true;
  $("#app").hidden = true;
  $("#login-view").hidden = false;
  setTimeout(() => $("#login-email").focus(), 50);
}

function mostrarApp() {
  $("#boot").hidden = true;
  $("#login-view").hidden = true;
  $("#app").hidden = false;
  const email = state.user?.email || "Modo pruebas";
  $("#user-email").textContent = email;
  $("#user-email").title = email;
  $("#user-avatar").textContent = (email[0] || "A").toUpperCase();
  $("#btn-logout").hidden = !CONFIG.requiereLogin;
  irA(location.hash.replace("#", "") || "resumen");
}

const ERRORES_AUTH = {
  "auth/invalid-credential": "Correo o contraseña incorrectos.",
  "auth/wrong-password": "Correo o contraseña incorrectos.",
  "auth/user-not-found": "Correo o contraseña incorrectos.",
  "auth/invalid-email": "El correo no tiene un formato válido.",
  "auth/too-many-requests": "Demasiados intentos. Espera unos minutos.",
  "auth/network-request-failed": "Sin conexión. Verifica tu internet.",
  "auth/user-disabled": "Esta cuenta está deshabilitada."
};

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#login-email").value.trim();
  const pass = $("#login-password").value;
  const err = $("#login-error");
  err.textContent = "";
  if (!email || !pass) {
    err.textContent = "Ingresa tu correo y contraseña.";
    return;
  }
  await conCarga($("#login-btn"), async () => {
    try {
      await signInWithEmailAndPassword(auth, email, pass);
    } catch (ex) {
      err.textContent = ERRORES_AUTH[ex.code] || "No fue posible iniciar sesión.";
    }
  });
});

$("#btn-logout").addEventListener("click", async () => {
  const r = await abrirModal({ titulo: "Cerrar sesión", html: "<p>¿Deseas salir del panel de administración?</p>", confirmar: "Salir", tipo: "danger" });
  if (r.ok) await signOut(auth);
});

/* ---------------------------------------------------------------------
   9. LISTENERS EN TIEMPO REAL (Firestore)
   --------------------------------------------------------------------- */

/**
 * Suscribe a los registros más recientes ordenados por CONFIG.campoFecha.
 * Si la colección no tiene ese campo (consulta vacía), usa una consulta
 * sin orden y ordena del lado del cliente.
 */
function suscribirRecientes(nombre, contexto, cb) {
  let unsubRespaldo = null;
  const q = query(collection(db, nombre), orderBy(CONFIG.campoFecha, "desc"), limit(CONFIG.limiteSeguridad));
  const unsub = onSnapshot(
    q,
    (snap) => {
      if (snap.empty) {
        if (!unsubRespaldo) {
          unsubRespaldo = onSnapshot(
            query(collection(db, nombre), limit(CONFIG.limiteSeguridad)),
            (s) => cb(ordenarDesc(mapDocs(s))),
            (err) => manejarError(contexto, err)
          );
        }
        return;
      }
      if (unsubRespaldo) {
        unsubRespaldo();
        unsubRespaldo = null;
      }
      cb(mapDocs(snap));
    },
    (err) => manejarError(contexto, err)
  );
  return () => {
    unsub();
    unsubRespaldo?.();
  };
}

/**
 * Escucha varias colecciones a la vez y entrega una sola lista ordenada.
 * Cada documento lleva `_col` con su colección de origen (para poder actualizarlo).
 */
function suscribirFusion(nombres, contexto, mensaje, tipoToast, cb, filtroAviso = () => true) {
  const partes = {};
  const unsubs = nombres.map((nombre) =>
    suscribirRecientes(nombre, contexto, (docs) => {
      docs.forEach((d) => (d._col = nombre));
      notificarNuevos(nombre, docs, mensaje, tipoToast, filtroAviso);
      partes[nombre] = docs;
      cb(ordenarDesc(Object.values(partes).flat()));
    })
  );
  return () => unsubs.forEach((u) => u());
}

/** Lanza un toast por cada documento nuevo que llega después de la carga inicial. */
function notificarNuevos(clave, docs, mensaje, tipo = "info", filtro = () => true) {
  const ids = docs.map((d) => d.id);
  if (state.vistos[clave] == null) {
    state.vistos[clave] = new Set(ids);
    return;
  }
  docs.filter((d) => !state.vistos[clave].has(d.id) && filtro(d)).slice(0, 3).forEach((d) => toast(mensaje(d), tipo, 7000));
  ids.forEach((id) => state.vistos[clave].add(id));
}

function iniciarListeners() {
  detenerListeners();

  state.unsubs.push(
    onSnapshot(
      collection(db, COL.casas),
      (snap) => {
        state.casas = mapDocs(snap).sort((a, b) => ordenCasa(a).localeCompare(ordenCasa(b), "es", { numeric: true }));
        state.cargado.casas = true;
        renderPagos();
        renderResumen();
      },
      (err) => manejarError("viviendas", err)
    ),

    onSnapshot(
      collection(db, COL.comunicados),
      (snap) => {
        state.comunicados = ordenarDesc(mapDocs(snap));
        state.cargado.comunicados = true;
        renderComunicados();
      },
      (err) => manejarError("comunicados", err)
    ),

    onSnapshot(
      collection(db, COL.reservaciones),
      (snap) => {
        const docs = ordenarDesc(mapDocs(snap));
        notificarNuevos("reservaciones", docs, (r) => `Nueva solicitud: ${amenidadDe(r)} · ${residenteDe(r)}`, "warning");
        state.reservaciones = docs;
        state.cargado.reservaciones = true;
        renderReservaciones();
        renderResumen();
      },
      (err) => manejarError("reservaciones", err)
    ),

    // Incidencias de residentes (incidencias) + reportes de rondín de la caseta (incidencias_seguridad)
    suscribirFusion(
      [COL.incidencias, COL.incidenciasSeguridad],
      "incidencias",
      (i) => `Nueva incidencia: ${pick(i, ["tipo", "titulo", "categoria"], "Reporte")} · ${guardiaDe(i)}`,
      "error",
      (docs) => {
        state.incidencias = docs;
        state.cargado.incidencias = true;
        renderSeguridad();
        renderResumen();
      },
      (i) => !incidenciaAtendida(i) // no avisar los rondines "sin novedad"
    ),

    // Accesos QR antiguos (accesos_qr) + accesos registrados por la caseta (accesos_registrados)
    suscribirFusion(
      [COL.accesos, COL.accesosRegistrados],
      "accesos",
      (a) => `Acceso: ${pick(a, ["visitante", "nombreVisitante", "nombre"], "Visitante")} → ${etiquetaCasa(casaDe(a))}`,
      "info",
      (docs) => {
        state.accesos = docs;
        state.cargado.accesos = true;
        renderSeguridad();
        renderResumen();
      }
    )
  );
}

function detenerListeners() {
  state.unsubs.forEach((u) => {
    try { u(); } catch { /* noop */ }
  });
  state.unsubs = [];
  state.vistos = {};
}

/* ---------------------------------------------------------------------
   10. RESUMEN
   --------------------------------------------------------------------- */
function setBadge(id, n) {
  const el = $(`#badge-${id}`);
  if (!el) return;
  el.hidden = !n;
  el.textContent = n > 99 ? "99+" : n;
}

function renderResumen() {
  const total = state.casas.length;
  const pagadas = state.casas.filter(estaPagada).length;
  const pct = total ? Math.round((pagadas / total) * 100) : 0;
  const pendientes = state.reservaciones.filter((r) => estatusReserva(r) === "pendiente");
  const abiertas = state.incidencias.filter((i) => !incidenciaAtendida(i));
  const hoy = new Date().toDateString();
  const accesosHoy = state.accesos.filter((a) => fechaDoc(a)?.toDateString() === hoy).length;

  const stat = (ic, label, value, hint, tipo, seccion) => `
    <button type="button" class="stat stat--${tipo}" data-action="ir" data-section="${seccion}">
      <span class="stat__icon">${icon(ic)}</span>
      <span class="stat__body">
        <span class="stat__label">${esc(label)}</span>
        <span class="stat__value">${esc(value)}</span>
        <span class="stat__hint">${esc(hint)}</span>
      </span>
    </button>`;

  $("#stats").innerHTML = [
    stat("cash", "Al corriente", `${pagadas}/${total}`, `${pct}% de cumplimiento`, "success", "pagos"),
    stat("alert", "Adeudos", total - pagadas, "Casas sin pago registrado", "danger", "pagos"),
    stat("calendar", "Reservas pendientes", pendientes.length, "Esperando aprobación", "warning", "amenidades"),
    stat("shield", "Incidencias abiertas", abiertas.length, `${accesosHoy} accesos QR hoy`, "info", "seguridad")
  ].join("");

  $("#resumen-incidencias").innerHTML =
    abiertas
      .slice(0, 5)
      .map((i) => {
        const foto = obtenerFotos(i)[0];
        return `<li class="mini-item">
          <span class="mini-item__icon mini-item__icon--danger">${foto ? `<img src="${esc(foto)}" alt="" loading="lazy">` : icon("alert")}</span>
          <span class="mini-item__body">
            <span class="mini-item__title clamp-2">${esc(pick(i, ["tipo", "titulo", "categoria"], "Incidencia"))}</span>
            <span class="mini-item__sub">${esc(guardiaDe(i))} · ${esc(tiempoRelativo(fechaDoc(i)))}</span>
          </span>
          <button type="button" class="link-btn" data-action="ver" data-col="incidencias" data-id="${esc(i.id)}">Ver</button>
        </li>`;
      })
      .join("") || vacio(state.cargado.incidencias ? "Sin incidencias abiertas" : "Cargando…", "shield");

  $("#resumen-reservas").innerHTML =
    pendientes
      .slice(0, 5)
      .map(
        (r) => `<li class="mini-item">
          <span class="mini-item__icon mini-item__icon--warning">${icon("calendar")}</span>
          <span class="mini-item__body">
            <span class="mini-item__title clamp-2">${esc(amenidadDe(r))}</span>
            <span class="mini-item__sub">${esc(residenteDe(r))} · ${esc(fmtFecha(toDate(diaReserva(r)), false))}</span>
          </span>
          <button type="button" class="link-btn" data-action="ir" data-section="amenidades">Revisar</button>
        </li>`
      )
      .join("") || vacio(state.cargado.reservaciones ? "No hay solicitudes pendientes" : "Cargando…", "calendar");

  setBadge("pagos", total - pagadas);
  setBadge("amenidades", pendientes.length);
  setBadge("seguridad", abiertas.length);
}

/* ---------------------------------------------------------------------
   11. CONTROL DE PAGOS
   --------------------------------------------------------------------- */
function poblarFiltrosCasas() {
  const unicos = (campo) =>
    [...new Set(state.casas.map((c) => c[campo]).filter((v) => v !== undefined && v !== null && v !== "").map(String))].sort((a, b) =>
      a.localeCompare(b, "es", { numeric: true })
    );
  const llenar = (sel, valores, todos, actual, etiqueta = (v) => v) => {
    const el = $(sel);
    el.innerHTML = `<option value="">${todos}</option>` + valores.map((v) => `<option value="${esc(v)}" ${v === actual ? "selected" : ""}>${esc(etiqueta(v))}</option>`).join("");
    el.hidden = valores.length < 2 && !actual;
  };
  llenar("#pagos-privada", unicos("privada"), "Todas las privadas", state.filtros.pagosPrivada);
  llenar("#pagos-fase", unicos("fase"), "Todas las fases", state.filtros.pagosFase, faseTexto);
}

function renderPagos() {
  const total = state.casas.length;
  const pagadas = state.casas.filter(estaPagada).length;
  const pct = total ? Math.round((pagadas / total) * 100) : 0;

  $("#pagos-resumen").textContent = `${pagadas} de ${total} casas al corriente`;
  $("#pagos-porcentaje").textContent = `${pct}%`;
  $("#pagos-barra").style.width = `${pct}%`;
  $("#pagos-progress").setAttribute("aria-valuenow", pct);
  poblarFiltrosCasas();

  const texto = normalizar(state.filtros.pagosTexto);
  const { pagosEstatus: filtro, pagosPrivada: privada, pagosFase: fase } = state.filtros;

  const filas = state.casas.filter((c) => {
    const p = estaPagada(c);
    if (filtro === "pagado" && !p) return false;
    if (filtro === "pendiente" && p) return false;
    if (privada && String(c.privada ?? "") !== privada) return false;
    if (fase && String(c.fase ?? "") !== fase) return false;
    if (!texto) return true;
    const personas = [...titularesDe(c), ...inquilinosDe(c)].map((x) => `${x.nombre} ${x.email || ""}`).join(" ");
    return normalizar(`${numeroCasa(c)} ${c.privada || ""} ${faseTexto(c.fase)} ${calleCasa(c)} ${personas}`).includes(texto);
  });

  const tbody = $("#pagos-tbody");
  if (!state.cargado.casas) return;
  if (!filas.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="table__empty">${
      total ? "Ninguna vivienda coincide con el filtro." : "Aún no hay viviendas registradas. Usa «Registrar casa» para comenzar."
    }</td></tr>`;
    return;
  }

  tbody.innerHTML = filas
    .map((c) => {
      const p = estaPagada(c);
      const fechaPago = toDate(pick(c, ["fechaPago", "ultimoPago", "fechaUltimoPago"], null));
      const ubic = ubicacionCasa(c) || calleCasa(c);
      const tit = titularesDe(c);
      const inq = inquilinosDe(c);
      const conAcceso = [...tit, ...inq].filter((x) => x.uid).length;
      return `<tr>
        <td data-label="Casa"><span><span class="casa-num">Casa ${esc(numeroCasa(c))}</span>${ubic ? `<span class="sub">${esc(ubic)}</span>` : ""}</span></td>
        <td data-label="Titulares">
          <span class="people-cell">
            <span>${esc(tit.map((x) => x.nombre).join(", ") || "Sin registrar")}</span>
            ${inq.length ? `<span class="sub">Inquilino: ${esc(inq.map((x) => x.nombre).join(", "))}</span>` : ""}
            <span class="people-cell__tags">
              ${conAcceso ? badge(`${conAcceso} con acceso`, "info") : badge("Sin accesos", "neutral")}
              ${inq.length ? badge("Rentada", "warning") : ""}
            </span>
          </span>
        </td>
        <td data-label="Estatus">${p ? badge("Pagado", "success") : badge("No pagado", "danger")}</td>
        <td data-label="Último pago"><span>${esc(fechaPago ? fmtFecha(fechaPago) : "—")}</span></td>
        <td data-label="Acciones" class="td-actions">
          <span class="td-actions__inner">
            ${
              p
                ? `<button type="button" class="btn btn--ghost btn--sm" data-action="revertir-pago" data-id="${esc(c.id)}">${icon("refresh")} Revertir</button>`
                : `<button type="button" class="btn btn--success btn--sm" data-action="marcar-pago" data-id="${esc(c.id)}">${icon("check")} Marcar pagado</button>`
            }
            <button type="button" class="btn btn--ghost btn--sm" data-action="editar-casa" data-id="${esc(c.id)}">${icon("user")} Editar</button>
            <button type="button" class="btn btn--ghost btn--sm" data-action="ver" data-col="casas" data-id="${esc(c.id)}" aria-label="Ver detalle">${icon("eye")}</button>
          </span>
        </td>
      </tr>`;
    })
    .join("");
}

async function cambiarPago(id, pagado, btn) {
  const c = buscar("casas", id);
  if (!c) return;
  const r = await abrirModal({
    titulo: pagado ? "Registrar pago" : "Revertir pago",
    html: pagado
      ? `<p>¿Confirmas que la <strong>${esc(etiquetaCompleta(c))}</strong> (${esc(propietario(c))}) realizó su pago?</p>
         <label class="field"><span class="field__label">Referencia / nota (opcional)</span>
         <input type="text" name="referencia" maxlength="120" placeholder="Ej. Transferencia 4521"></label>`
      : `<p>La <strong>${esc(etiquetaCompleta(c))}</strong> volverá a marcarse como <strong>No pagado</strong>.</p>`,
    confirmar: pagado ? "Marcar como pagado" : "Revertir",
    tipo: pagado ? "success" : "danger"
  });
  if (!r.ok) return;

  const campo = campoEstatusCasa(c);
  const hoy = new Date();
  const mes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;
  const cambios = {
    [campo]: pagado ? "Pagado" : "No Pagado",
    pagado,
    // Historial que ve el residente en su portal ("YYYY-MM")
    mesesPagados: pagado ? arrayUnion(mes) : arrayRemove(mes),
    fechaPago: pagado ? serverTimestamp() : null,
    actualizadoPor: emailAdmin(),
    actualizadoEn: serverTimestamp()
  };
  if (pagado && r.datos.referencia) cambios.referenciaPago = r.datos.referencia;

  try {
    await conCarga(btn, () => updateDoc(doc(db, COL.casas, id), cambios));
    toast(pagado ? `${etiquetaCompleta(c)} marcada como pagada` : `Pago de ${etiquetaCompleta(c)} revertido`, "success");
  } catch (err) {
    manejarError("actualizar el pago", err);
  }
}

/* ---------- Registro de casas: privada, fase, titulares, inquilinos y accesos ---------- */
const contrasenaTemporal = () => {
  const abc = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return [...crypto.getRandomValues(new Uint32Array(10))].map((n) => abc[n % abc.length]).join("");
};

function personaHTML(grupo, p = {}) {
  const esInq = grupo === "inquilinos";
  const conAcceso = Boolean(p.uid);
  const hasta = p.contratoHasta ? String(p.contratoHasta).slice(0, 10) : "";
  return `<div class="persona" data-grupo="${grupo}" data-uid="${esc(p.uid || "")}">
    <div class="persona__head">
      <strong class="persona__title">${esInq ? "Inquilino" : "Titular"}</strong>
      <button type="button" class="icon-btn icon-btn--sm" data-persona-quitar aria-label="Quitar persona">${icon("trash")}</button>
    </div>
    <div class="grid-3">
      <label class="field"><span class="field__label">Nombre completo *</span>
        <input class="p-nombre" maxlength="100" value="${esc(p.nombre || "")}" autocomplete="off"></label>
      <label class="field"><span class="field__label">Teléfono</span>
        <input class="p-tel" type="tel" inputmode="tel" maxlength="20" value="${esc(p.telefono || "")}" autocomplete="off"></label>
      <label class="field"><span class="field__label">Correo${conAcceso ? " (usuario del portal)" : ""}</span>
        <input class="p-email" type="email" maxlength="120" value="${esc(p.email || "")}" autocomplete="off" ${conAcceso ? "readonly" : ""}></label>
    </div>
    ${esInq ? `<label class="field persona__hasta"><span class="field__label">Contrato vigente hasta (opcional)</span><input class="p-hasta" type="date" value="${esc(hasta)}"></label>` : ""}
    ${
      conAcceso
        ? `<div class="persona__acceso is-on">${icon("check")}<span>Tiene acceso al portal</span>
             <button type="button" class="link-btn" data-persona-reset>Enviar correo para cambiar contraseña</button></div>`
        : `<div class="persona__acceso">
             <label class="check-inline"><input type="checkbox" class="p-crear" ${p.nombre ? "" : "checked"}> Crear acceso al portal de residentes</label>
             <div class="persona__pass">
               <span class="field__label">Contraseña temporal</span>
               <div class="pass-row">
                 <input class="p-pass" minlength="6" maxlength="40" value="${contrasenaTemporal()}" autocomplete="off" spellcheck="false">
                 <button type="button" class="btn btn--ghost btn--sm" data-persona-generar aria-label="Generar otra contraseña">${icon("refresh")}</button>
               </div>
             </div>
           </div>`
    }
  </div>`;
}

function formCasaHTML(c) {
  const unicos = (campo) => [...new Set(state.casas.map((x) => x[campo]).filter(Boolean).map(String))].sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
  const titulares = c ? titularesDe(c) : [{}];
  const tieneInq = Boolean(c?.tieneInquilinos);
  const inquilinos = c && Array.isArray(c.inquilinos) && c.inquilinos.length ? c.inquilinos : [{}];
  return `
    <div class="grid-3">
      <label class="field"><span class="field__label">Número de casa *</span>
        <input name="numero" required maxlength="20" value="${esc(c ? numeroCasa(c) : "")}" placeholder="Ej. 24" autocomplete="off"></label>
      <label class="field"><span class="field__label">Privada *</span>
        <input name="privada" required maxlength="60" list="dl-privadas" value="${esc(c?.privada || "")}" placeholder="Ej. Privada Roble" autocomplete="off"></label>
      <label class="field"><span class="field__label">Fase *</span>
        <input name="fase" required maxlength="20" list="dl-fases" value="${esc(c?.fase ?? "")}" placeholder="Ej. 2" autocomplete="off"></label>
    </div>
    <datalist id="dl-privadas">${unicos("privada").map((v) => `<option value="${esc(v)}">`).join("")}</datalist>
    <datalist id="dl-fases">${unicos("fase").map((v) => `<option value="${esc(v)}">`).join("")}</datalist>

    <section class="people" data-grupo="titulares">
      <div class="people__head">
        <h4 class="people__title">Titulares de la casa</h4>
        <button type="button" class="btn btn--ghost btn--sm" data-persona-agregar="titulares">${icon("plus")} Agregar titular</button>
      </div>
      <div class="people__list">${titulares.map((p) => personaHTML("titulares", p)).join("")}</div>
    </section>

    <label class="switch-row">
      <input type="checkbox" id="chk-inquilinos" ${tieneInq ? "checked" : ""}>
      <span><strong>La casa tiene inquilinos</strong>
      <small>Se les da un perfil de inquilino: pueden generar pases, reservar y reportar, pero no ven el historial de pagos ni votan.</small></span>
    </label>

    <section class="people" data-grupo="inquilinos" ${tieneInq ? "" : "hidden"}>
      <div class="people__head">
        <h4 class="people__title">Inquilinos</h4>
        <button type="button" class="btn btn--ghost btn--sm" data-persona-agregar="inquilinos">${icon("plus")} Agregar inquilino</button>
      </div>
      <div class="people__list">${inquilinos.map((p) => personaHTML("inquilinos", p)).join("")}</div>
    </section>

    ${
      c
        ? ""
        : `<label class="field"><span class="field__label">Estatus de pago inicial</span>
             <select name="estatus"><option value="No Pagado">No pagado</option><option value="Pagado">Pagado</option></select></label>`
    }
    <p class="form-hint">${icon("shield")}<span>Cada persona con acceso entra al Portal de Residentes con su correo y la contraseña temporal. Al terminar te mostraremos las credenciales para entregarlas.</span></p>`;
}

/** Ajusta campos obligatorios y numeración según lo que esté visible. */
function syncPersonas() {
  const body = $("#modal-body");
  $$(".people", body).forEach((sec) => {
    const visible = !sec.hidden;
    $$(".persona", sec).forEach((el, i) => {
      const esInq = el.dataset.grupo === "inquilinos";
      el.querySelector(".persona__title").textContent = `${esInq ? "Inquilino" : "Titular"} ${i + 1}`;
      el.querySelector(".p-nombre").required = visible;
      const crear = el.querySelector(".p-crear");
      const email = el.querySelector(".p-email");
      if (crear) {
        const on = visible && crear.checked;
        email.required = on;
        el.querySelector(".p-pass").required = on;
        el.querySelector(".persona__pass").hidden = !crear.checked;
      }
    });
  });
}

function leerPersonas(grupo) {
  const sec = $(`#modal-body .people[data-grupo="${grupo}"]`);
  if (!sec || sec.hidden) return [];
  return $$(".persona", sec)
    .map((el) => ({
      uid: el.dataset.uid || null,
      nombre: el.querySelector(".p-nombre").value.trim().replace(/\s+/g, " "),
      telefono: el.querySelector(".p-tel").value.trim(),
      email: el.querySelector(".p-email").value.trim().toLowerCase(),
      crearAcceso: Boolean(el.querySelector(".p-crear")?.checked),
      password: el.querySelector(".p-pass")?.value || "",
      contratoHasta: el.querySelector(".p-hasta")?.value || ""
    }))
    .filter((p) => p.nombre);
}

// Interacciones del formulario de casa (delegadas en el cuerpo del modal)
$("#modal-body").addEventListener("click", async (e) => {
  const agregar = e.target.closest("[data-persona-agregar]");
  if (agregar) {
    const grupo = agregar.dataset.personaAgregar;
    const lista = $(`#modal-body .people[data-grupo="${grupo}"] .people__list`);
    if (lista.children.length >= MAX_PERSONAS) return toast(`Máximo ${MAX_PERSONAS} personas por grupo.`, "warning");
    lista.insertAdjacentHTML("beforeend", personaHTML(grupo));
    syncPersonas();
    lista.lastElementChild.querySelector(".p-nombre").focus();
    return;
  }
  const quitar = e.target.closest("[data-persona-quitar]");
  if (quitar) {
    const persona = quitar.closest(".persona");
    const lista = persona.parentElement;
    if (persona.dataset.grupo === "titulares" && lista.children.length <= 1) return toast("La casa debe tener al menos un titular.", "warning");
    if (persona.dataset.uid && !confirm("Esta persona perderá su acceso al portal al guardar. ¿Continuar?")) return;
    persona.remove();
    syncPersonas();
    return;
  }
  const generar = e.target.closest("[data-persona-generar]");
  if (generar) {
    generar.closest(".persona").querySelector(".p-pass").value = contrasenaTemporal();
    return;
  }
  const reset = e.target.closest("[data-persona-reset]");
  if (reset) {
    const email = reset.closest(".persona").querySelector(".p-email").value.trim();
    if (!email) return;
    try {
      await sendPasswordResetEmail(auth, email);
      toast(`Se envió un correo a ${email} para cambiar su contraseña.`, "success", 6000);
    } catch (err) {
      toast(`No se pudo enviar el correo: ${mensajeAuth(err)}`, "error", 6000);
    }
    return;
  }
  const copiar = e.target.closest("[data-copiar]");
  if (copiar) {
    const texto = $("#modal-body .cred-text")?.value || "";
    try {
      await navigator.clipboard.writeText(texto);
      toast("Credenciales copiadas", "success");
    } catch {
      $("#modal-body .cred-text")?.select();
      toast("Selecciona el texto y cópialo manualmente.", "info");
    }
  }
});

$("#modal-body").addEventListener("change", (e) => {
  if (e.target.matches(".p-crear")) syncPersonas();
  if (e.target.id === "chk-inquilinos") {
    $('#modal-body .people[data-grupo="inquilinos"]').hidden = !e.target.checked;
    syncPersonas();
  }
});

function mensajeAuth(err) {
  const mapa = {
    "auth/email-already-in-use": "ese correo ya tiene una cuenta",
    "auth/invalid-email": "el correo no es válido",
    "auth/weak-password": "la contraseña debe tener al menos 6 caracteres",
    "auth/operation-not-allowed": "activa «Correo/contraseña» en Firebase Authentication",
    "auth/network-request-failed": "sin conexión a internet",
    "auth/too-many-requests": "demasiados intentos, espera unos minutos"
  };
  return mapa[err?.code] || err?.message || "error desconocido";
}

function validarFormCasa(datos, titulares, inquilinos, casaActual) {
  if (!titulares.length) return "Registra al menos un titular.";
  const numero = datos.numero.replace(/^casa\s*/i, "").trim();
  const duplicada = state.casas.find(
    (x) =>
      x.id !== casaActual?.id &&
      normalizar(numeroCasa(x)) === normalizar(numero) &&
      normalizar(x.privada) === normalizar(datos.privada) &&
      normalizar(x.fase) === normalizar(datos.fase)
  );
  if (duplicada) return `Ya existe la Casa ${numero} en ${datos.privada}, ${faseTexto(datos.fase)}.`;
  const personas = [...titulares, ...inquilinos];
  const correos = personas.filter((p) => p.email).map((p) => p.email);
  if (new Set(correos).size !== correos.length) return "Hay correos repetidos entre titulares e inquilinos.";
  const sinCorreo = personas.find((p) => !p.uid && p.crearAcceso && !p.email);
  if (sinCorreo) return `Falta el correo de ${sinCorreo.nombre} para crear su acceso.`;
  const passCorta = personas.find((p) => !p.uid && p.crearAcceso && p.password.length < 6);
  if (passCorta) return `La contraseña de ${passCorta.nombre} debe tener al menos 6 caracteres.`;
  return "";
}

/** Alta o edición de una casa con sus titulares, inquilinos y cuentas del portal. */
async function editarCasa(id) {
  const c = id ? buscar("casas", id) : null;
  if (id && !c) return;

  const opciones = {
    titulo: c ? `Editar ${etiquetaCompleta(c)}` : "Registrar casa",
    html: formCasaHTML(c),
    confirmar: c ? "Guardar cambios" : "Registrar casa",
    ancho: true
  };
  let promesa = abrirModal(opciones);
  syncPersonas();

  // Si algo no es válido se reabre el mismo formulario sin perder lo capturado
  let r, titulares, inquilinos;
  for (;;) {
    r = await promesa;
    if (!r.ok) return;
    titulares = leerPersonas("titulares");
    inquilinos = $("#chk-inquilinos").checked ? leerPersonas("inquilinos") : [];
    const error = validarFormCasa(r.datos, titulares, inquilinos, c);
    if (!error) break;
    toast(error, "warning", 6000);
    promesa = abrirModal({ ...opciones, conservar: true });
  }

  const numero = r.datos.numero.replace(/^casa\s*/i, "").trim();
  const privada = r.datos.privada.trim();
  const fase = r.datos.fase.trim();
  const ref = c ? doc(db, COL.casas, c.id) : doc(collection(db, COL.casas));
  const etiqueta = etiquetaCompleta({ numero, privada, fase });
  const personas = [
    ...titulares.map((p) => ({ ...p, rol: "titular" })),
    ...inquilinos.map((p) => ({ ...p, rol: "inquilino" }))
  ];

  toast(c ? "Guardando cambios…" : "Registrando casa…", "info", 2500);

  // ======== 1) FIREBASE AUTH: crear las cuentas nuevas del portal ========
  const credenciales = [];
  const fallos = [];
  for (const p of personas) {
    if (p.uid || !p.crearAcceso) continue;
    try {
      const cred = await createUserWithEmailAndPassword(authAltas, p.email, p.password);
      p.uid = cred.user.uid;
      p.nuevo = true;
      credenciales.push({ nombre: p.nombre, rol: p.rol, email: p.email, password: p.password });
    } catch (err) {
      fallos.push(`${p.nombre} (${p.email}): ${mensajeAuth(err)}`);
    }
  }
  await signOut(authAltas).catch(() => {});

  // ======== 2) FIRESTORE: casa + perfiles de usuario en una sola operación ========
  const limpiar = (p) => ({
    nombre: p.nombre,
    telefono: p.telefono || "",
    email: p.email || "",
    uid: p.uid || null,
    ...(p.rol === "inquilino" ? { contratoHasta: p.contratoHasta || null } : {})
  });

  const datosCasa = {
    numero,
    privada,
    fase,
    etiqueta,
    titulares: personas.filter((p) => p.rol === "titular").map(limpiar),
    tieneInquilinos: personas.some((p) => p.rol === "inquilino"),
    inquilinos: personas.filter((p) => p.rol === "inquilino").map(limpiar),
    propietario: titulares[0].nombre,
    uidsAcceso: personas.filter((p) => p.uid).map((p) => p.uid),
    actualizadoPor: emailAdmin(),
    actualizadoEn: serverTimestamp()
  };
  if (!c) {
    const pagado = r.datos.estatus === "Pagado";
    const hoy = new Date();
    Object.assign(datosCasa, {
      estatusPago: pagado ? "Pagado" : "No Pagado",
      pagado,
      mesesPagados: pagado ? [`${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`] : [],
      fechaPago: pagado ? serverTimestamp() : null,
      [CONFIG.campoFecha]: serverTimestamp()
    });
  }

  try {
    const batch = writeBatch(db);
    batch.set(ref, datosCasa, { merge: true });

    personas
      .filter((p) => p.uid)
      .forEach((p) =>
        batch.set(
          doc(db, COL.usuarios, p.uid),
          {
            uid: p.uid,
            nombre: p.nombre,
            email: p.email,
            telefono: p.telefono || "",
            rol: p.rol,                       // "titular" | "inquilino"
            casaId: ref.id,
            casa: etiqueta,
            numero,
            privada,
            fase,
            contratoHasta: p.rol === "inquilino" ? p.contratoHasta || null : null,
            activo: true,
            actualizadoPor: emailAdmin(),
            actualizadoEn: serverTimestamp(),
            ...(p.nuevo ? { creadoEn: serverTimestamp() } : {})
          },
          { merge: true }
        )
      );

    // Quien ya no aparece en la casa pierde el acceso al portal
    const antes = c ? [...titularesDe(c), ...(Array.isArray(c.inquilinos) ? c.inquilinos : [])].map((p) => p.uid).filter(Boolean) : [];
    const ahora = new Set(personas.map((p) => p.uid).filter(Boolean));
    antes
      .filter((u) => !ahora.has(u))
      .forEach((u) =>
        batch.set(doc(db, COL.usuarios, u), { activo: false, desactivadoEn: serverTimestamp(), desactivadoPor: emailAdmin() }, { merge: true })
      );

    await batch.commit();
  } catch (err) {
    manejarError("guardar la casa", err);
    return;
  }

  if (credenciales.length || fallos.length) mostrarCredenciales(etiqueta, credenciales, fallos);
  else toast(c ? `${etiqueta} actualizada` : `${etiqueta} registrada`, "success");
}

function mostrarCredenciales(etiqueta, credenciales, fallos) {
  const texto = credenciales
    .map(
      (k) =>
        `Portal de Residentes · ${etiqueta}\n${k.nombre} (${k.rol === "titular" ? "Titular" : "Inquilino"})\nUsuario: ${k.email}\nContraseña temporal: ${k.password}`
    )
    .join("\n\n");
  abrirModal({
    titulo: "Casa guardada · accesos",
    soloLectura: true,
    ancho: true,
    html: `
      ${
        credenciales.length
          ? `<div class="alert alert--success">${icon("check")}<div>Se crearon <strong>${credenciales.length}</strong> acceso(s). Entrega estas credenciales; cada persona podrá cambiar su contraseña desde el portal.</div></div>
             <div class="cred-list">${credenciales
               .map(
                 (k) => `<div class="cred">
                   <strong>${esc(k.nombre)}</strong> ${badge(k.rol === "titular" ? "Titular" : "Inquilino", k.rol === "titular" ? "info" : "warning")}
                   <span>Usuario: <code>${esc(k.email)}</code></span>
                   <span>Contraseña: <code>${esc(k.password)}</code></span>
                 </div>`
               )
               .join("")}</div>
             <textarea class="cred-text" readonly rows="4" aria-label="Credenciales en texto">${esc(texto)}</textarea>
             <button type="button" class="btn btn--primary" data-copiar>${icon("check")} Copiar credenciales</button>`
          : ""
      }
      ${
        fallos.length
          ? `<div class="alert alert--danger">${icon("alert")}<div><strong>No se pudo crear el acceso de:</strong><br>${fallos.map(esc).join("<br>")}<br><small>La casa sí se guardó. Edita la casa para intentarlo con otro correo.</small></div></div>`
          : ""
      }`
  });
}

async function nuevoPeriodo(btn) {
  const pagadas = state.casas.filter(estaPagada);
  if (!pagadas.length) {
    toast("No hay casas marcadas como pagadas", "info");
    return;
  }
  const r = await abrirModal({
    titulo: "Iniciar nuevo periodo de cobro",
    html: `<div class="alert alert--danger">${icon("alert")}<div>Se marcarán <strong>${pagadas.length}</strong> casa(s) como <strong>No pagado</strong>. Esta acción no se puede deshacer automáticamente.</div></div>
      <label class="field"><span class="field__label">Escribe <strong>CONFIRMAR</strong> para continuar</span>
      <input name="confirmacion" required pattern="CONFIRMAR" autocomplete="off"></label>`,
    confirmar: "Reiniciar estatus",
    tipo: "danger"
  });
  if (!r.ok || r.datos.confirmacion !== "CONFIRMAR") return;

  try {
    await conCarga(btn, async () => {
      for (let i = 0; i < pagadas.length; i += 450) {
        const batch = writeBatch(db);
        pagadas.slice(i, i + 450).forEach((c) =>
          batch.update(doc(db, COL.casas, c.id), {
            [campoEstatusCasa(c)]: "No Pagado",
            pagado: false,
            actualizadoPor: emailAdmin(),
            actualizadoEn: serverTimestamp()
          })
        );
        await batch.commit();
      }
    });
    toast("Nuevo periodo iniciado", "success");
  } catch (err) {
    manejarError("reiniciar el periodo", err);
  }
}

$("#pagos-buscar").addEventListener("input", (e) => {
  state.filtros.pagosTexto = e.target.value;
  renderPagos();
});
$("#pagos-privada").addEventListener("change", (e) => {
  state.filtros.pagosPrivada = e.target.value;
  renderPagos();
});
$("#pagos-fase").addEventListener("change", (e) => {
  state.filtros.pagosFase = e.target.value;
  renderPagos();
});
$("#pagos-filtro").addEventListener("click", (e) => {
  const b = e.target.closest("[data-filtro]");
  if (!b) return;
  state.filtros.pagosEstatus = b.dataset.filtro;
  $$("#pagos-filtro .segmented__btn").forEach((x) => x.classList.toggle("is-active", x === b));
  renderPagos();
});

/* ---------------------------------------------------------------------
   12. COMUNICADOS
   --------------------------------------------------------------------- */
const formCom = $("#form-comunicado");

function sincronizarTipo() {
  const esEvento = formCom.tipo.value === "Evento";
  const esVotacion = formCom.tipo.value === "Votación";
  $("#campos-evento").hidden = !esEvento;
  $("#campos-votacion").hidden = !esVotacion;
  formCom.fechaEvento.required = esEvento;
  formCom.opciones.required = esVotacion;
}
formCom.addEventListener("change", (e) => e.target.name === "tipo" && sincronizarTipo());
formCom.contenido.addEventListener("input", () => ($("#contador-contenido").textContent = formCom.contenido.value.length));
formCom.addEventListener("reset", () =>
  setTimeout(() => {
    sincronizarTipo();
    $("#contador-contenido").textContent = "0";
    $("#comunicado-error").textContent = "";
  })
);

formCom.addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#comunicado-error");
  err.textContent = "";

  const fd = new FormData(formCom);
  const tipo = fd.get("tipo");
  const titulo = String(fd.get("titulo") || "").trim();
  const contenido = String(fd.get("contenido") || "").trim();
  const prioridad = fd.get("prioridad") || "normal";

  if (titulo.length < 3) return (err.textContent = "El título debe tener al menos 3 caracteres.");
  if (contenido.length < 10) return (err.textContent = "El contenido debe tener al menos 10 caracteres.");

  const data = {
    tipo,
    titulo,
    contenido,
    prioridad,
    activo: true,
    autor: emailAdmin(),
    [CONFIG.campoFecha]: serverTimestamp()
  };

  if (tipo === "Evento") {
    const fe = fd.get("fechaEvento");
    if (!fe) return (err.textContent = "Indica la fecha y hora del evento.");
    const fecha = new Date(fe);
    if (isNaN(fecha)) return (err.textContent = "La fecha del evento no es válida.");
    data.fechaEvento = Timestamp.fromDate(fecha);
    data.lugar = String(fd.get("lugar") || "").trim();
  }

  if (tipo === "Votación") {
    const opciones = [...new Set(String(fd.get("opciones") || "").split("\n").map((o) => o.trim()).filter(Boolean))];
    if (opciones.length < 2) return (err.textContent = "La votación necesita al menos 2 opciones (una por línea).");
    if (opciones.length > 8) return (err.textContent = "Máximo 8 opciones por votación.");
    data.opciones = opciones;
    data.votos = {}; // { "Casa 12": "Opción elegida" } — un voto por casa
    const cierre = fd.get("cierre");
    if (cierre) data.cierre = Timestamp.fromDate(new Date(cierre));
  }

  try {
    await conCarga($("#btn-publicar"), () => addDoc(collection(db, COL.comunicados), data));
    formCom.reset();
    toast(`${tipo} publicado correctamente`, "success");
  } catch (ex) {
    manejarError("publicar el comunicado", ex);
  }
});

function renderComunicados() {
  const filtro = state.filtros.comunicados;
  const lista = state.comunicados.filter((c) => filtro === "todos" || pick(c, ["tipo"], "Noticia") === filtro);
  const tipoBadge = { Noticia: "info", Aviso: "warning", Evento: "success", "Votación": "neutral" };

  const resultados = (c) => {
    if (!Array.isArray(c.opciones) || !c.opciones.length) return "";
    const votos = Object.values(c.votos || {});
    const total = votos.length;
    return `<div class="poll-admin">${c.opciones
      .map((o) => {
        const n = votos.filter((v) => v === o).length;
        const pct = total ? Math.round((n / total) * 100) : 0;
        return `<div class="poll-admin__row">
          <div class="poll-admin__head"><span>${esc(o)}</span><strong>${n} · ${pct}%</strong></div>
          <div class="poll-admin__bar"><span style="width:${pct}%"></span></div>
        </div>`;
      })
      .join("")}<small class="muted">${total} ${total === 1 ? "casa ha votado" : "casas han votado"}</small></div>`;
  };

  $("#comunicados-lista").innerHTML =
    lista
      .map((c) => {
        const tipo = pick(c, ["tipo"], "Noticia");
        const fe = toDate(c.fechaEvento);
        return `<li class="feed__item feed__item--${esc(normalizar(tipo))} ${c.prioridad === "alta" ? "is-alta" : ""}">
          <div class="row-between">
            <span>${badge(tipo, tipoBadge[tipo] || "neutral")} ${c.prioridad === "alta" ? badge("Prioridad alta", "danger") : ""}</span>
            <button type="button" class="icon-btn" data-action="eliminar-comunicado" data-id="${esc(c.id)}" aria-label="Eliminar publicación">${icon("trash")}</button>
          </div>
          <h4 class="feed__title">${esc(pick(c, ["titulo"], "Sin título"))}</h4>
          <p class="feed__text clamp-3">${esc(pick(c, ["contenido", "mensaje", "descripcion"], ""))}</p>
          ${tipo === "Votación" ? resultados(c) : ""}
          <div class="feed__meta">
            <span>${icon("clock")}${esc(tiempoRelativo(fechaDoc(c)))}</span>
            ${fe ? `<span>${icon("calendar")}${esc(fmtFecha(fe))}</span>` : ""}
            ${c.lugar ? `<span>${icon("pin")}${esc(c.lugar)}</span>` : ""}
            ${c.autor ? `<span>${icon("user")}${esc(c.autor)}</span>` : ""}
          </div>
        </li>`;
      })
      .join("") || vacio(state.cargado.comunicados ? "Aún no hay publicaciones" : "Cargando…", "megaphone");
}

async function eliminarComunicado(id, btn) {
  const c = buscar("comunicados", id);
  if (!c) return;
  const r = await abrirModal({
    titulo: "Eliminar publicación",
    html: `<p>¿Eliminar «<strong>${esc(c.titulo || "Sin título")}</strong>»? Los residentes dejarán de verla.</p>`,
    confirmar: "Eliminar",
    tipo: "danger"
  });
  if (!r.ok) return;
  try {
    await conCarga(btn, () => deleteDoc(doc(db, COL.comunicados, id)));
    toast("Publicación eliminada", "success");
  } catch (err) {
    manejarError("eliminar la publicación", err);
  }
}

$("#comunicados-filtro").addEventListener("click", (e) => {
  const b = e.target.closest("[data-filtro]");
  if (!b) return;
  state.filtros.comunicados = b.dataset.filtro;
  $$("#comunicados-filtro .segmented__btn").forEach((x) => x.classList.toggle("is-active", x === b));
  renderComunicados();
});

/* ---------------------------------------------------------------------
   13. AMENIDADES (RESERVACIONES)
   --------------------------------------------------------------------- */
function renderReservaciones() {
  const conteo = { pendiente: 0, aprobada: 0, denegada: 0, todas: state.reservaciones.length };
  state.reservaciones.forEach((r) => conteo[estatusReserva(r)]++);
  $$("#reservas-tabs [data-count]").forEach((el) => (el.textContent = conteo[el.dataset.count]));

  const grid = $("#reservas-grid");
  if (!state.cargado.reservaciones) {
    grid.innerHTML = skeletons();
    return;
  }

  const filtro = state.filtros.reservas;
  const lista = state.reservaciones.filter((r) => filtro === "todas" || estatusReserva(r) === filtro);
  // Pendientes: las más próximas primero
  if (filtro === "pendiente") {
    lista.sort((a, b) => (toDate(diaReserva(a))?.getTime() || Infinity) - (toDate(diaReserva(b))?.getTime() || Infinity));
  }

  const etiquetas = { pendiente: ["Pendiente", "warning"], aprobada: ["Aprobada", "success"], denegada: ["Denegada", "danger"] };
  const mensajesVacio = {
    pendiente: "No hay solicitudes pendientes. ¡Todo al día!",
    aprobada: "No hay reservaciones aprobadas.",
    denegada: "No hay reservaciones denegadas.",
    todas: "Aún no hay solicitudes de reservación."
  };

  grid.innerHTML =
    lista
      .map((r) => {
        const est = estatusReserva(r);
        const [txt, tipo] = etiquetas[est];
        const ini = horaIni(r);
        const fin = horaFin(r);
        const notas = pick(r, ["notas", "comentarios", "motivo", "descripcion", "evento"], "");
        const choque = est === "pendiente" && conflictos(r).length > 0;
        const revision = est !== "pendiente" ? pick(r, ["motivoRechazo", "notaAdmin"], "") : "";
        return `<article class="card item-card">
          <div class="row-between">
            <h3 class="item-card__title">${esc(amenidadDe(r))}</h3>
            ${badge(txt, tipo)}
          </div>
          <ul class="meta">
            <li>${icon("user")}<span><strong>${esc(residenteDe(r))}</strong> · ${esc(etiquetaCasa(casaDe(r)))}</span></li>
            <li>${icon("calendar")}<span>${esc(fmtFecha(toDate(diaReserva(r)), false))}</span></li>
            ${ini || fin ? `<li>${icon("clock")}<span>${esc(ini || "?")} – ${esc(fin || "?")}</span></li>` : ""}
            ${r.invitados ? `<li>${icon("user")}<span>${esc(r.invitados)} invitados</span></li>` : ""}
          </ul>
          ${notas ? `<p class="item-card__text clamp-3">${esc(notas)}</p>` : ""}
          ${choque ? `<div class="alert alert--warning">${icon("alert")}<span>Se empalma con otra reservación aprobada.</span></div>` : ""}
          ${revision ? `<p class="item-card__note"><strong>${est === "denegada" ? "Motivo" : "Nota"}:</strong> ${esc(revision)}</p>` : ""}
          <div class="card__foot">
            <button type="button" class="btn btn--ghost btn--sm" data-action="ver" data-col="reservaciones" data-id="${esc(r.id)}">${icon("eye")} Ver</button>
            ${
              est === "pendiente"
                ? `<button type="button" class="btn btn--outline-danger btn--sm" data-action="denegar" data-id="${esc(r.id)}">${icon("x")} Denegar</button>
                   <button type="button" class="btn btn--success btn--sm" data-action="aprobar" data-id="${esc(r.id)}">${icon("check")} Aprobar</button>`
                : ""
            }
          </div>
        </article>`;
      })
      .join("") || vacioGrid(mensajesVacio[filtro], "calendar");
}

async function aprobarReserva(id, btn) {
  const r = buscar("reservaciones", id);
  if (!r) return;
  const choques = conflictos(r);
  const res = await abrirModal({
    titulo: "Aprobar reservación",
    html: `<p>¿Aprobar <strong>${esc(amenidadDe(r))}</strong> para <strong>${esc(residenteDe(r))}</strong> (${esc(etiquetaCasa(casaDe(r)))}) el ${esc(fmtFecha(toDate(diaReserva(r)), false))}?</p>
      ${
        choques.length
          ? `<div class="alert alert--warning">${icon("alert")}<div><strong>Posible empalme:</strong> ya hay ${choques.length} reservación(es) aprobada(s) para esta amenidad en ese horario (${choques
              .map((c) => esc(residenteDe(c)))
              .join(", ")}).</div></div>`
          : ""
      }
      <label class="field"><span class="field__label">Nota para el residente (opcional)</span>
      <textarea name="nota" rows="3" maxlength="300" placeholder="Ej. Recuerde dejar el área limpia."></textarea></label>`,
    confirmar: "Aprobar",
    tipo: "success"
  });
  if (!res.ok) return;
  try {
    await conCarga(btn, () =>
      updateDoc(doc(db, COL.reservaciones, id), {
        [campoEstatusReserva(r)]: "aprobada",
        notaAdmin: res.datos.nota || "",
        motivoRechazo: null,
        revisadoPor: emailAdmin(),
        fechaRevision: serverTimestamp()
      })
    );
    toast("Reservación aprobada", "success");
  } catch (err) {
    manejarError("aprobar la reservación", err);
  }
}

async function denegarReserva(id, btn) {
  const r = buscar("reservaciones", id);
  if (!r) return;
  const res = await abrirModal({
    titulo: "Denegar reservación",
    html: `<p>Vas a denegar <strong>${esc(amenidadDe(r))}</strong> solicitada por <strong>${esc(residenteDe(r))}</strong>.</p>
      <label class="field"><span class="field__label">Motivo (se mostrará al residente) *</span>
      <textarea name="motivo" rows="3" required minlength="5" maxlength="300" placeholder="Ej. La cancha está en mantenimiento esa fecha."></textarea></label>`,
    confirmar: "Denegar",
    tipo: "danger"
  });
  if (!res.ok) return;
  try {
    await conCarga(btn, () =>
      updateDoc(doc(db, COL.reservaciones, id), {
        [campoEstatusReserva(r)]: "denegada",
        motivoRechazo: res.datos.motivo,
        revisadoPor: emailAdmin(),
        fechaRevision: serverTimestamp()
      })
    );
    toast("Reservación denegada", "success");
  } catch (err) {
    manejarError("denegar la reservación", err);
  }
}

$("#reservas-tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-filtro]");
  if (!b) return;
  state.filtros.reservas = b.dataset.filtro;
  $$("#reservas-tabs .tab").forEach((x) => {
    x.classList.toggle("is-active", x === b);
    x.setAttribute("aria-selected", String(x === b));
  });
  renderReservaciones();
});

/* ---------------------------------------------------------------------
   14. SEGURIDAD (INCIDENCIAS + ACCESOS QR)
   --------------------------------------------------------------------- */
function galeria(fotos, col, id, alt) {
  if (!fotos.length) {
    return `<div class="gallery gallery--empty">${icon("image")}<span>Sin fotografía</span></div>`;
  }
  return `<button type="button" class="gallery" data-action="foto" data-col="${col}" data-id="${esc(id)}" aria-label="Ver fotografías de ${esc(alt)}">
    <img src="${esc(fotos[0])}" alt="${esc(alt)}" loading="lazy" decoding="async">
    ${fotos.length > 1 ? `<span class="gallery__count">${icon("image")} ${fotos.length}</span>` : ""}
  </button>`;
}

function cardIncidencia(i) {
  const fotos = obtenerFotos(i);
  const atendida = incidenciaAtendida(i);
  const titulo = pick(i, ["tipo", "titulo", "categoria", "asunto"], "Incidencia");
  const prioridad = normalizar(pick(i, ["prioridad", "gravedad", "nivel", "urgencia"], ""));
  const prioBadge = /alt|grave|urgent|crit/.test(prioridad)
    ? badge("Prioridad alta", "danger")
    : /medi/.test(prioridad)
      ? badge("Prioridad media", "warning")
      : prioridad
        ? badge(`Prioridad ${prioridad}`, "neutral")
        : "";
  const ubicacion = pick(i, ["ubicacion", "lugar", "zona", "area", "casa"], "");
  const d = fechaDoc(i);

  return `<article class="card sec-card item-card ${atendida ? "is-done" : ""}">
    ${galeria(fotos, "incidencias", i.id, titulo)}
    <div class="sec-card__body">
      <div class="row-between">
        <h3 class="item-card__title">${esc(titulo)}</h3>
        ${atendida ? badge("Atendida", "success") : badge("Abierta", "danger")}
      </div>
      ${prioBadge ? `<div>${prioBadge}</div>` : ""}
      <p class="item-card__text clamp-3">${esc(pick(i, ["descripcion", "reporte", "detalle", "mensaje", "observaciones"], "Sin descripción"))}</p>
      <ul class="meta">
        <li>${icon("shield")}<span>${esc(guardiaDe(i))}</span></li>
        ${ubicacion && typeof ubicacion === "string" ? `<li>${icon("pin")}<span>${esc(ubicacion)}</span></li>` : ""}
        <li>${icon("clock")}<span title="${esc(fmtFecha(d))}">${esc(tiempoRelativo(d))}</span></li>
      </ul>
    </div>
    <div class="card__foot">
      <button type="button" class="btn btn--ghost btn--sm" data-action="ver" data-col="incidencias" data-id="${esc(i.id)}">${icon("eye")} Detalle</button>
      ${atendida ? "" : `<button type="button" class="btn btn--success btn--sm" data-action="atender" data-id="${esc(i.id)}">${icon("check")} Marcar atendida</button>`}
    </div>
  </article>`;
}

function cardAcceso(a) {
  const fotos = obtenerFotos(a);
  const visitante = pick(a, ["visitante", "nombreVisitante", "nombre", "invitado"], "Visitante");
  const tipo = normalizar(pick(a, ["tipoAcceso", "movimiento", "tipo", "accion"], "entrada"));
  const esSalida = /sal/.test(tipo);
  const valido = pick(a, ["valido", "autorizado"], true) !== false && !/rechaz|deneg|invalid/.test(normalizar(pick(a, ["estatus", "estado"], "")));
  const placas = pick(a, ["placas", "vehiculo", "placa"], "");
  const residente = pick(a, ["residente", "anfitrion", "autorizadoPor"], "");
  const d = fechaDoc(a);

  return `<article class="card sec-card item-card">
    ${galeria(fotos, "accesos", a.id, visitante)}
    <div class="sec-card__body">
      <div class="row-between">
        <h3 class="item-card__title">${esc(visitante)}</h3>
        <span>${valido ? badge(esSalida ? "Salida" : "Entrada", esSalida ? "neutral" : "info") : badge("QR rechazado", "danger")}</span>
      </div>
      <ul class="meta">
        <li>${icon("home")}<span><strong>${esc(etiquetaCasa(casaDe(a)))}</strong>${residente ? ` · ${esc(residente)}` : ""}</span></li>
        ${placas ? `<li>${icon("car")}<span>${esc(placas)}</span></li>` : ""}
        <li>${icon("shield")}<span>${esc(guardiaDe(a))}</span></li>
        <li>${icon("clock")}<span title="${esc(fmtFecha(d))}">${esc(fmtFecha(d))}</span></li>
      </ul>
    </div>
    <div class="card__foot">
      <button type="button" class="btn btn--ghost btn--sm" data-action="ver" data-col="accesos" data-id="${esc(a.id)}">${icon("eye")} Detalle</button>
    </div>
  </article>`;
}

function renderSeguridad() {
  $('#seguridad-tabs [data-count="incidencias"]').textContent = state.incidencias.filter((i) => !incidenciaAtendida(i)).length;
  $('#seguridad-tabs [data-count="accesos"]').textContent = state.accesos.length;

  const vista = state.filtros.seguridad;
  const grid = $("#seguridad-grid");
  if (!state.cargado[vista]) {
    grid.innerHTML = skeletons();
    return;
  }

  const texto = normalizar(state.filtros.seguridadTexto);
  const coincide = (o) => !texto || normalizar(Object.values(o).filter((v) => typeof v === "string" || typeof v === "number").join(" ")).includes(texto);

  if (vista === "incidencias") {
    // Abiertas primero, luego por fecha
    const lista = state.incidencias.filter(coincide).sort((a, b) => Number(incidenciaAtendida(a)) - Number(incidenciaAtendida(b)));
    grid.innerHTML = lista.map(cardIncidencia).join("") || vacioGrid(texto ? "Sin resultados para la búsqueda." : "No hay incidencias reportadas.", "shield");
  } else {
    const lista = state.accesos.filter(coincide);
    grid.innerHTML = lista.map(cardAcceso).join("") || vacioGrid(texto ? "Sin resultados para la búsqueda." : "No hay accesos QR registrados.", "qr");
  }
}

async function atenderIncidencia(id, btn) {
  const i = buscar("incidencias", id);
  if (!i) return;
  const res = await abrirModal({
    titulo: "Marcar incidencia como atendida",
    html: `<p>«<strong>${esc(pick(i, ["tipo", "titulo", "categoria"], "Incidencia"))}</strong>» reportada por ${esc(guardiaDe(i))}.</p>
      <label class="field"><span class="field__label">Resolución / comentario (opcional)</span>
      <textarea name="resolucion" rows="3" maxlength="400" placeholder="Ej. Se contactó al residente y se retiró el vehículo."></textarea></label>`,
    confirmar: "Marcar atendida",
    tipo: "success"
  });
  if (!res.ok) return;
  try {
    await conCarga(btn, () =>
      updateDoc(doc(db, i._col || COL.incidencias, id), {
        [("estado" in i && !("estatus" in i)) ? "estado" : "estatus"]: "atendida",
        resolucion: res.datos.resolucion || "",
        atendidaPor: emailAdmin(),
        fechaAtencion: serverTimestamp()
      })
    );
    toast("Incidencia marcada como atendida", "success");
  } catch (err) {
    manejarError("actualizar la incidencia", err);
  }
}

$("#seguridad-tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-filtro]");
  if (!b) return;
  state.filtros.seguridad = b.dataset.filtro;
  $$("#seguridad-tabs .tab").forEach((x) => {
    x.classList.toggle("is-active", x === b);
    x.setAttribute("aria-selected", String(x === b));
  });
  renderSeguridad();
});
$("#seguridad-buscar").addEventListener("input", (e) => {
  state.filtros.seguridadTexto = e.target.value;
  renderSeguridad();
});

/* ---------------------------------------------------------------------
   15. DELEGACIÓN DE ACCIONES
   --------------------------------------------------------------------- */
function buscar(col, id) {
  return (state[col] || []).find((x) => x.id === id) || null;
}

const ACCIONES = {
  ir: (btn) => irA(btn.dataset.section),
  ver: (btn) => verDetalle(btn.dataset.col, btn.dataset.id),
  foto: (btn) => {
    const item = buscar(btn.dataset.col, btn.dataset.id);
    if (item) abrirLightbox(obtenerFotos(item), 0, btn.dataset.col === "incidencias" ? "Incidencia" : "Acceso QR");
  },
  "marcar-pago": (btn) => cambiarPago(btn.dataset.id, true, btn),
  "revertir-pago": (btn) => cambiarPago(btn.dataset.id, false, btn),
  "agregar-casa": () => editarCasa(null),
  "editar-casa": (btn) => editarCasa(btn.dataset.id),
  "nuevo-periodo": (btn) => nuevoPeriodo(btn),
  "eliminar-comunicado": (btn) => eliminarComunicado(btn.dataset.id, btn),
  aprobar: (btn) => aprobarReserva(btn.dataset.id, btn),
  denegar: (btn) => denegarReserva(btn.dataset.id, btn),
  atender: (btn) => atenderIncidencia(btn.dataset.id, btn)
};

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn || btn.disabled) return;
  const fn = ACCIONES[btn.dataset.action];
  if (fn) {
    e.preventDefault();
    fn(btn);
  }
});

// Refresca tiempos relativos ("hace 3 minutos") cada minuto
setInterval(() => {
  if (!$("#app").hidden) {
    renderResumen();
    if (!$("#sec-seguridad").hidden) renderSeguridad();
    if (!$("#sec-comunicados").hidden) renderComunicados();
  }
}, 60000);

/* ---------------------------------------------------------------------
   16. ARRANQUE
   --------------------------------------------------------------------- */
renderReservaciones();
renderSeguridad();

if (CONFIG.requiereLogin) {
  onAuthStateChanged(auth, async (user) => {
    if (user && user.uid !== CONFIG.adminUid) {
      // Usuario válido en Firebase Auth, pero no es el administrador
      state.user = null;
      detenerListeners();
      await signOut(auth);
      mostrarLogin();
      $("#login-error").textContent = "Esta cuenta no tiene permisos de administrador.";
      return;
    }
    if (user) {
      state.user = user;
      mostrarApp();
      iniciarListeners();
    } else {
      state.user = null;
      detenerListeners();
      mostrarLogin();
    }
  });
} else {
  mostrarApp();
  iniciarListeners();
}