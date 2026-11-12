export const RETAIL = 'RETAIL_CUSTOMER';
export const WHOLESALE = 'WHOLESALE_RESELLER';

export class PortalError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function requireValue(condition, message, status = 400) {
  if (!condition) throw new PortalError(status, message);
}
export function field(value, label, max = 120, min = 1) {
  const result = typeof value === 'string' ? value.trim() : '';
  requireValue(result.length >= min && result.length <= max, label + ' inválido.');
  return result;
}
export function integer(value, min, max, label) {
  requireValue(Number.isSafeInteger(value) && value >= min && value <= max, label + ' inválida.');
  return value;
}
export function uuid(value) {
  requireValue(typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value), 'Identificador inválido.');
  return value.toLowerCase();
}
export function email(value) {
  const result = field(value, 'E-mail', 254).toLowerCase();
  requireValue(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result), 'E-mail inválido.');
  return result;
}
export function phone(value) {
  const result = field(value, 'Telefone', 30).replace(/\D/g, '');
  requireValue(result.length >= 10 && result.length <= 13, 'Telefone inválido.');
  return result;
}
const states = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
export function state(value) {
  const result = field(value, 'UF', 2, 2).toUpperCase();
  requireValue(states.includes(result), 'UF inválida.');
  return result;
}
export function taxId(value) {
  const number = field(value, 'CPF ou CNPJ', 24).replace(/\D/g, '');
  const cpf = number.length === 11;
  requireValue((cpf || number.length === 14) && !/^(\d)\1+$/.test(number), 'CPF ou CNPJ inválido.');
  const valid = (length, weights) => {
    const sum = weights.reduce((total, weight, i) => total + weight * Number(number[i]), 0);
    const digit = cpf ? (sum * 10) % 11 : 11 - (sum % 11);
    return Number(number[length]) === (digit >= 10 ? 0 : digit);
  };
  const weights = length => Array.from({ length }, (_, i) => length + 1 - i);
  requireValue(cpf ? valid(9, weights(9)) && valid(10, weights(10))
    : valid(12, [5,4,3,2,9,8,7,6,5,4,3,2]) && valid(13, [6,5,4,3,2,9,8,7,6,5,4,3,2]), 'CPF ou CNPJ inválido.');
  return number;
}
export function address(data) {
  const zip = field(data.zip, 'CEP', 10).replace(/\D/g, '');
  requireValue(zip.length === 8, 'CEP inválido.');
  return {
    zip, street: field(data.street,'Rua'), number: field(data.number,'Número',20),
    district: field(data.district,'Bairro'), city: field(data.city,'Cidade'), state: state(data.state),
    complement: field(data.complement,'Complemento',120,0), reference: field(data.reference,'Referência',200,0)
  };
}
export const wholesale = account => account.role === WHOLESALE && account.status === 'ACTIVE';
export function quote(product, account, quantity, now = Date.now()) {
  integer(quantity, 1, 10000, 'Quantidade');
  requireValue(product.active && product.on_hand - product.reserved >= quantity, 'Quantidade indisponível.', 409);
  requireValue(account.role === RETAIL || wholesale(account), 'Conta sem acesso a compras.', 403);
  if (account.role === RETAIL) {
    requireValue(product.retail_cents > 0, 'Produto sem preço de varejo cadastrado.', 409);
    return product.retail_cents;
  }
  const tier = activeTiers(product, now).filter(t => quantity >= t.minimum).at(-1);
  requireValue(tier && quantity % product.wholesale_multiple === 0,
    'A quantidade precisa atender ao mínimo e ao múltiplo de atacado.', 409);
  return tier.cents;
}
export function activeTiers(product, now = Date.now()) {
  return product.wholesale_until && Date.parse(product.wholesale_until) <= now ? [] : product.wholesale_tiers;
}
export function productView(product, account) {
  const permitted = wholesale(account);
  return { sku:product.sku, name:product.name, category:product.category, brand:product.brand,
    image:product.image, available: Math.max(0, product.on_hand - product.reserved), active:product.active,
    retail_cents: product.retail_cents,
    ...(permitted && { tiers:activeTiers(product), multiple:product.wholesale_multiple }) };
}
const transitions = {
  RECEIVED:['AWAITING_CONFIRMATION','CONFIRMED','CANCELLED'],
  AWAITING_CONFIRMATION:['CONFIRMED','CANCELLED'],
  CONFIRMED:['PICKING','CANCELLED'],
  PICKING:['SHIPPED','CANCELLED'],
  SHIPPED:['DELIVERED'], DELIVERED:[], CANCELLED:[]
};
export function stockEffect(current, next, quantity) {
  requireValue(transitions[current]?.includes(next), 'Transição de pedido inválida.', 409);
  if (next === 'CONFIRMED') return ['RESERVED', 0, quantity];
  if (next === 'SHIPPED') return ['SHIPPED', -quantity, -quantity];
  if (next === 'CANCELLED' && ['CONFIRMED','PICKING'].includes(current)) return ['RELEASED', 0, -quantity];
  return null;
}
export function imagePath(value) {
  const path = field(value, 'Imagem', 500, 0);
  requireValue(!path || /^\/Public\/[\p{L}\p{N}\s_().%+/-]+\.(?:png|jpe?g|webp|avif)$/iu.test(path) &&
    !/(?:\.\.|%2e|%2f|%5c)/i.test(path), 'Use um caminho de imagem do catálogo.');
  return path || null;
}
