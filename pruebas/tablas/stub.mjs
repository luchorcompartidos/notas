const P = new Proxy(function () {}, { get: (t, k) => (k === 'then' ? undefined : P), apply: () => P, construct: () => P });
export default P;
export const Extension = { create: (cfg) => ({ cfg, configure: () => P, extend: () => P }) };
export const Editor = P, Node = P, Mark = P, mergeAttributes = P;
export const ySyncPluginKey = { getState: () => null };
