/* PrivetFlow: local, schema-checked transformations. No remote rules or code. */
(() => {
  'use strict';
  const parse = JSON.parse;
  const stringify = JSON.stringify;
  const origin = 'https://flow.google.com';
  const maxSize = 2 * 1024 * 1024;
  const countryKeys = ['isCountrySupported', 'is_country_supported'];
  const regionStates = new Set(['REGION_UNAVAILABLE', 'COUNTRY_UNSUPPORTED', 'UNAVAILABLE_IN_REGION', 'UNAVAILABLE_IN_COUNTRY']);

  function classify(input, base = origin) {
    try {
      const u = new URL(typeof input === 'object' && input?.url ? input.url : String(input), base);
      if (u.origin !== origin) return null;
      if (u.pathname === '/_/AiSandboxAngularFrontend/data/batchexecute' && u.searchParams.get('rpcids')?.split(',').includes('cPZSdc')) return 'rpc';
      const leaf = u.pathname.split('/').filter(Boolean).at(-1);
      const names = ['fetchToolAvailability', 'checkAppAvailability'];
      if (names.includes(leaf)) return 'availability';
      if (u.pathname.includes('/trpc/') && leaf?.split(',').every(n => names.map(k => `general.${k}`).includes(n))) return 'availability';
    } catch { /* Invalid URLs pass through. */ }
    return null;
  }

  function rpc(data) {
    const result = {changed: 0, recognized: 0, blocked: false, mismatch: false};
    if (!Array.isArray(data)) return result;
    for (const row of data) {
      if (!Array.isArray(row) || row[0] !== 'wrb.fr' || row[1] !== 'cPZSdc' || typeof row[2] !== 'string') continue;
      try {
        const config = parse(row[2]);
        if (!Array.isArray(config) || config.length < 32 || ![null, true, false, 0, 1].includes(config[30])) {
          result.mismatch = true;
          continue;
        }
        result.recognized++;
        // The adjacent age eligibility field is never modified.
        if (config[31] !== true && config[31] !== 1) { result.blocked = true; continue; }
        if (config[30] === true || config[30] === 1) continue;
        config[30] = typeof config[30] === 'number' ? 1 : true;
        row[2] = stringify(config);
        result.changed++;
      } catch { result.mismatch = true; }
    }
    return result;
  }

  function availability(data) {
    const result = {changed: 0, recognized: 0, blocked: false, mismatch: false};
    const nodes = [], pending = [data];
    while (pending.length) {
      const node = pending.pop();
      if (!node || typeof node !== 'object') continue;
      if (nodes.length > 10000) return {...result, mismatch: true};
      if (node.error != null) continue;
      nodes.push(node);
      pending.push(...Object.values(node).filter(x => x && typeof x === 'object'));
      for (const key of ['isAgeSupported', 'is_age_supported']) {
        if (Object.hasOwn(node, key) && node[key] !== true && node[key] !== 1) result.blocked = true;
      }
      if (typeof node.availabilityState === 'string' && /AGE|MINOR|SUSPEND|DISABLED|QUOTA|SUBSCRIPTION|PERMISSION|AUTH/.test(node.availabilityState)) result.blocked = true;
    }
    if (result.blocked) return result;
    for (const node of nodes) {
      const denied = countryKeys.some(k => node[k] === false);
      for (const key of countryKeys) {
        if (typeof node[key] !== 'boolean') continue;
        result.recognized++;
        if (!node[key]) { node[key] = true; result.changed++; }
      }
      if (regionStates.has(node.availabilityState) || (denied && node.availabilityState === 'UNAVAILABLE')) {
        node.availabilityState = 'AVAILABLE'; result.recognized++; result.changed++;
      }
    }
    return result;
  }

  function transform(body, kind) {
    const meta = {changed: 0, recognized: 0, blocked: false, mismatch: false};
    if (typeof body !== 'string' || body.length > maxSize) return {body, ...meta, mismatch: true};
    const merge = r => { meta.changed += r.changed; meta.recognized += r.recognized; meta.blocked ||= r.blocked; meta.mismatch ||= r.mismatch; };
    try {
      if (kind === 'availability') {
        const data = parse(body); merge(availability(data));
        return {body: meta.changed ? stringify(data) : body, ...meta};
      }
      // Plain JSON, XSSI-prefixed JSON and line-framed RPC responses.
      const prefix = body.match(/^\)\]\}'\r?\n(?:\r?\n)?/)?.[0] || '';
      const rest = body.slice(prefix.length);
      try {
        const data = parse(rest); merge(rpc(data));
        return {body: meta.changed ? prefix + stringify(data) : body, ...meta};
      } catch { /* Try framed transport. */ }
      const lines = rest.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].trimStart().startsWith('[[')) continue;
        const text = lines[i].replace(/\r$/, '');
        const data = parse(text), r = rpc(data);
        if (r.changed) {
          const n = Number(lines[i - 1]);
          const measures = [s => new TextEncoder().encode(s).length, s => s.length];
          const measure = /^\d+\r?$/.test(lines[i - 1] || '') && measures.find(fn => [0, 1, 2].includes(n - fn(text)));
          if (!measure) return {body, changed: 0, recognized: 0, blocked: false, mismatch: true};
          const next = stringify(data);
          lines[i - 1] = String(n + measure(next) - measure(text)) + (lines[i - 1].endsWith('\r') ? '\r' : '');
          lines[i] = next + (lines[i].endsWith('\r') ? '\r' : '');
        }
        merge(r);
      }
      return {body: meta.changed ? prefix + lines.join('\n') : body, ...meta};
    } catch { return {body, changed: 0, recognized: 0, blocked: false, mismatch: true}; }
  }

  if (typeof module !== 'undefined' && module.exports) { module.exports = {classify, rpc, availability, transform}; return; }
  if (location.origin !== origin || window.__privetFlow) return;
  const diagnostic = {version: '1.0.0', state: 'waiting', changed: 0, recognized: 0, errors: 0};
  Object.defineProperty(window, '__privetFlow', {value: diagnostic, configurable: true});
  function record(r) {
    diagnostic.changed += r.changed;
    diagnostic.recognized += r.recognized;
    if (r.mismatch) diagnostic.errors++;
    diagnostic.state = r.blocked ? 'restricted' : diagnostic.changed ? 'applied' : diagnostic.recognized ? 'available' : r.mismatch ? 'unknown' : diagnostic.state;
  }

  // Covers streamed RPC frames parsed by the page without changing frame sizes.
  JSON.parse = function(text, reviver) {
    const value = Reflect.apply(parse, this, arguments);
    if (reviver === undefined && typeof text === 'string' && text.length <= maxSize && text.includes('cPZSdc') && text.includes('wrb.fr')) record(rpc(value));
    return value;
  };

  const nativeFetch = window.fetch;
  window.fetch = async function(resource, options) {
    const response = await Reflect.apply(nativeFetch, this, arguments);
    const kind = classify(resource, location.href);
    if (!kind || !response.ok || (response.url && !classify(response.url, location.href))) return response;
    try {
      const r = transform(await response.clone().text(), kind); record(r);
      if (!r.changed) return response;
      const headers = new Headers(response.headers);
      headers.delete('content-length'); headers.delete('content-encoding');
      const replacement = new Response(r.body, {status: response.status, statusText: response.statusText, headers});
      const wrap = target => new Proxy(target, {get(obj, key) {
        if (['url', 'redirected', 'type'].includes(key)) return response[key];
        if (key === 'clone') return () => wrap(obj.clone());
        const value = Reflect.get(obj, key, obj);
        return typeof value === 'function' ? value.bind(obj) : value;
      }});
      return wrap(replacement);
    } catch { record({changed: 0, recognized: 0, mismatch: true}); return response; }
  };

  const proto = XMLHttpRequest.prototype, nativeOpen = proto.open, requests = new WeakMap();
  proto.open = function(method, url) {
    const result = Reflect.apply(nativeOpen, this, arguments);
    requests.set(this, {kind: classify(url, location.href), cache: new Map()});
    return result;
  };
  for (const property of ['response', 'responseText']) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, property);
    if (!descriptor?.get || !descriptor.configurable) continue;
    Object.defineProperty(proto, property, {...descriptor, get() {
      const raw = Reflect.apply(descriptor.get, this, []), info = requests.get(this);
      if (!info?.kind || this.readyState !== 4 || this.status < 200 || this.status >= 300 || !classify(this.responseURL, location.href)) return raw;
      const isJson = property === 'response' && this.responseType === 'json';
      if (!isJson && typeof raw !== 'string') return raw;
      const key = isJson ? 'json' : 'text';
      if (info.cache.has(key)) return info.cache.get(key);
      try {
        const r = transform(isJson ? stringify(raw) : raw, info.kind); record(r);
        const value = r.changed ? isJson ? parse(r.body) : r.body : raw;
        info.cache.set(key, value); return value;
      } catch { info.cache.set(key, raw); return raw; }
    }});
  }
})();
