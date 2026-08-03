export const STAGES = {
  comprar: 0,
  reservar_estoque: 5,
  aguardando_entrega: 25,
  compra_atrasada: 25,
  recebido_parcial: 38,
  atendimento_parcial: 50,
  aguarda_pintura: 48,
  em_pintura: 60,
  pintura_atrasada: 60,
  pintura_retorno_parcial: 68,
  pronto_separar: 74,
  separado_parcial: 80,
  separado: 90,
  enviado_parcial: 94,
  enviado_obra: 100
};

export function number(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined || value === '') return 0;
  let text = String(value).trim().replace(/\s/g, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) text = text.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+(,\d+)$/.test(text)) text = text.replace(',', '.');
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function isPast(date) {
  return Boolean(date) && new Date(`${date}T23:59:59`).getTime() < Date.now();
}

export function allocation(material = {}) {
  const required = Math.max(0, number(material.qtyRequired));
  const source = material.source || 'pendente';

  if (source === 'estoque') {
    return { required, source, stockQty: required, purchaseQty: 0, unallocatedQty: 0 };
  }
  if (source === 'compra') {
    return { required, source, stockQty: 0, purchaseQty: required, unallocatedQty: 0 };
  }
  if (source === 'misto') {
    const stockQty = clamp(number(material.stockRequiredQty), 0, required);
    const explicitPurchase = material.purchaseRequiredQty !== undefined && material.purchaseRequiredQty !== null && material.purchaseRequiredQty !== '';
    const purchaseQty = clamp(explicitPurchase ? number(material.purchaseRequiredQty) : required - stockQty, 0, required - stockQty);
    const unallocatedQty = Math.max(0, required - stockQty - purchaseQty);
    return { required, source, stockQty, purchaseQty, unallocatedQty };
  }
  return { required, source, stockQty: 0, purchaseQty: 0, unallocatedQty: required };
}

export function deliveryToPainting(material = {}) {
  const { purchaseQty } = allocation(material);
  return Boolean(material.paintingRequired && purchaseQty > 0 && material.purchaseDeliveryDestination === 'pintura');
}

export function directPaintingDeliveredQty(material = {}) {
  const { purchaseQty } = allocation(material);
  if (!deliveryToPainting(material)) return 0;
  return clamp(number(material.directPaintingDeliveredQty), 0, purchaseQty);
}

export function purchaseCommitted(material = {}) {
  const { purchaseQty } = allocation(material);
  if (purchaseQty <= 0) return true;
  if (material.purchaseDate || material.orderNumber) return true;
  if (number(material.qtyReceived) > 0 || number(material.directPaintingDeliveredQty) > 0) return true;
  return ['aguardando_entrega', 'compra_atrasada', 'recebido_parcial', 'em_pintura', 'pintura_atrasada', 'pintura_retorno_parcial'].includes(material.status);
}

export function receivedPurchaseQty(material = {}) {
  const { purchaseQty } = allocation(material);
  const delivered = deliveryToPainting(material)
    ? directPaintingDeliveredQty(material)
    : number(material.qtyReceived);
  return clamp(delivered, 0, purchaseQty);
}

export function availableQty(material = {}) {
  const { required, stockQty } = allocation(material);
  return clamp(stockQty + receivedPurchaseQty(material), 0, required);
}

export function paintingSentQty(material = {}) {
  const available = availableQty(material);
  const internalSent = Math.max(0, number(material.paintingSentQty));
  const directSent = directPaintingDeliveredQty(material);
  return clamp(internalSent + directSent, 0, available);
}

export function separableQty(material = {}) {
  const { required } = allocation(material);
  const available = availableQty(material);
  if (!material.paintingRequired) return available;
  return clamp(number(material.paintingReturnedQty), 0, Math.min(required, available));
}

export function committedQty(material = {}) {
  const { required, stockQty, purchaseQty } = allocation(material);
  const purchase = purchaseQty > 0 && purchaseCommitted(material) ? purchaseQty : 0;
  return clamp(stockQty + purchase, 0, required);
}

export function sourceNeedsDefinition(material = {}) {
  return allocation(material).unallocatedQty > 0;
}

export function purchaseNeedsAction(material = {}) {
  const { purchaseQty } = allocation(material);
  return purchaseQty > 0 && !purchaseCommitted(material);
}

export function deriveStatus(material = {}) {
  const { required, stockQty, purchaseQty, unallocatedQty } = allocation(material);
  const delivered = clamp(number(material.siteDeliveredQty), 0, required || Number.MAX_SAFE_INTEGER);
  const separated = clamp(number(material.separatedQty), 0, required || Number.MAX_SAFE_INTEGER);
  const received = receivedPurchaseQty(material);
  const available = availableQty(material);
  const paintSent = paintingSentQty(material);
  const paintReturned = clamp(number(material.paintingReturnedQty), 0, paintSent || Number.MAX_SAFE_INTEGER);

  if (required > 0 && delivered >= required) return 'enviado_obra';
  if (delivered > 0) return 'enviado_parcial';
  if (required > 0 && separated >= required) return 'separado';
  if (separated > 0) return 'separado_parcial';

  if (material.paintingRequired) {
    if (required > 0 && paintReturned >= required) return 'pronto_separar';
    if (paintReturned > 0) return 'pintura_retorno_parcial';
    if (paintSent > 0) return isPast(material.paintingEta) ? 'pintura_atrasada' : 'em_pintura';
  }

  if (required > 0 && available >= required) return material.paintingRequired ? 'aguarda_pintura' : 'pronto_separar';

  if (available > 0) {
    if (unallocatedQty > 0 || (purchaseQty > 0 && !purchaseCommitted(material))) return 'atendimento_parcial';
    return material.paintingRequired ? 'aguarda_pintura' : 'recebido_parcial';
  }

  if (unallocatedQty > 0) return 'comprar';
  if (purchaseQty > 0) {
    if (!purchaseCommitted(material)) return 'comprar';
    if (received < purchaseQty) return isPast(material.deliveryEta) ? 'compra_atrasada' : 'aguardando_entrega';
  }
  if (stockQty > 0) return material.paintingRequired ? 'aguarda_pintura' : 'pronto_separar';
  return 'comprar';
}

export function progress(material = {}) {
  const status = deriveStatus(material);
  if (['enviado_obra', 'enviado_parcial', 'separado', 'separado_parcial', 'em_pintura', 'pintura_atrasada', 'pintura_retorno_parcial', 'pronto_separar'].includes(status)) {
    return STAGES[status] ?? 0;
  }

  const { required, stockQty, purchaseQty } = allocation(material);
  if (!required) return STAGES[status] ?? 0;

  const stockStage = stockQty > 0 ? (material.paintingRequired ? STAGES.aguarda_pintura : STAGES.pronto_separar) : 0;
  let purchaseStage = 0;
  if (purchaseQty > 0 && purchaseCommitted(material)) {
    const received = receivedPurchaseQty(material);
    if (received >= purchaseQty) {
      purchaseStage = material.paintingRequired
        ? (deliveryToPainting(material) ? STAGES.em_pintura : STAGES.aguarda_pintura)
        : STAGES.pronto_separar;
    } else if (received > 0) purchaseStage = STAGES.recebido_parcial;
    else purchaseStage = STAGES.aguardando_entrega;
  }

  return Math.round(((stockQty * stockStage) + (purchaseQty * purchaseStage)) / required);
}

export function summaryForMaterials(materials = {}) {
  const list = Array.isArray(materials) ? materials : Object.values(materials || {});
  const summary = {
    total: list.length,
    completed: 0,
    pending: 0,
    committed: 0,
    commitmentProgress: 0,
    definirOrigem: 0,
    comprar: 0,
    aguardandoEntrega: 0,
    comprasAtrasadas: 0,
    pintura: 0,
    pinturaAtrasada: 0,
    separar: 0,
    separados: 0,
    enviados: 0,
    progress: 0,
    updatedAt: Date.now()
  };

  let progressSum = 0;
  let requiredSum = 0;
  let committedSum = 0;

  list.forEach(material => {
    const alloc = allocation(material);
    const status = deriveStatus(material);
    const received = receivedPurchaseQty(material);
    const separated = number(material.separatedQty);
    const delivered = number(material.siteDeliveredQty);
    const separable = separableQty(material);
    const committed = committedQty(material);
    const paintSent = paintingSentQty(material);

    progressSum += progress(material);
    requiredSum += alloc.required;
    committedSum += committed;

    if (alloc.required > 0 && committed >= alloc.required) summary.committed += 1;
    else summary.pending += 1;

    if (status === 'enviado_obra') {
      summary.completed += 1;
      summary.enviados += 1;
    }

    if (sourceNeedsDefinition(material)) summary.definirOrigem += 1;
    else if (purchaseNeedsAction(material)) summary.comprar += 1;
    if (alloc.purchaseQty > 0 && purchaseCommitted(material) && received < alloc.purchaseQty) {
      if (isPast(material.deliveryEta)) summary.comprasAtrasadas += 1;
      else summary.aguardandoEntrega += 1;
    }

    if (material.paintingRequired && !['separado', 'enviado_parcial', 'enviado_obra'].includes(status)) {
      if (status === 'pintura_atrasada') summary.pinturaAtrasada += 1;
      else if (availableQty(material) > 0 || paintSent > 0) summary.pintura += 1;
    }

    if (separable > separated || (separated > delivered && delivered < alloc.required)) summary.separar += 1;
    if (alloc.required > 0 && separated >= alloc.required && delivered < alloc.required) summary.separados += 1;
  });

  summary.progress = list.length ? Math.round(progressSum / list.length) : 0;
  summary.commitmentProgress = requiredSum ? Math.round((committedSum / requiredSum) * 100) : 0;
  return summary;
}
