const { createHash } = require('node:crypto');
const { setGlobalOptions } = require('firebase-functions/v2');
const { onValueWritten } = require('firebase-functions/v2/database');
const logger = require('firebase-functions/logger');
const { initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();
setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

const EPSILON = 0.000001;

function normalizedUnit(material = {}) {
  return String(material.unit || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function isDecimalUnit(material = {}) {
  return ['m', 'm2', 'm²', 'metro', 'metros', 'kg'].includes(normalizedUnit(material));
}

function quantityNumber(material = {}, value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0;
    if (isDecimalUnit(material) && Number.isInteger(value) && Math.abs(value) >= 1000) return value / 1000;
    return value;
  }
  let text = String(value).trim().replace(/\s/g, '');
  if (!text) return 0;
  if (text.includes(',') && text.includes('.')) {
    if (text.lastIndexOf(',') > text.lastIndexOf('.')) text = text.replace(/\./g, '').replace(',', '.');
    else text = text.replace(/,/g, '');
  } else if (text.includes(',')) text = text.replace(',', '.');
  else if (text.includes('.') && !isDecimalUnit(material) && /^-?\d{1,3}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, '');
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function allocation(material = {}) {
  const required = Math.max(0, quantityNumber(material, material.qtyRequired));
  const source = material.source || 'pendente';
  if (source === 'compra') return { required, purchaseQty: required };
  if (source === 'misto') {
    const stockQty = clamp(quantityNumber(material, material.stockRequiredQty), 0, required);
    const explicitPurchase = material.purchaseRequiredQty !== undefined
      && material.purchaseRequiredQty !== null
      && material.purchaseRequiredQty !== '';
    const purchaseQty = clamp(
      explicitPurchase ? quantityNumber(material, material.purchaseRequiredQty) : required - stockQty,
      0,
      required - stockQty
    );
    return { required, purchaseQty };
  }
  return { required, purchaseQty: 0 };
}

function receivedQuantity(material = {}) {
  const { purchaseQty } = allocation(material);
  return clamp(quantityNumber(material, material.qtyReceived), 0, purchaseQty || Number.MAX_SAFE_INTEGER);
}

function formatQuantity(value) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(value);
}

function materialCategory(material = {}) {
  return String(material.category || 'Sem categoria').trim() || 'Sem categoria';
}

function purchaseMaterials(materials = {}) {
  return Object.entries(materials)
    .map(([id, material]) => ({ id, material, purchaseQty: allocation(material).purchaseQty }))
    .filter(item => item.purchaseQty > EPSILON);
}

function categoryState(materials = {}, category = '') {
  const items = purchaseMaterials(materials).filter(item => materialCategory(item.material) === category);
  const complete = items.length > 0 && items.every(item => receivedQuantity(item.material) + EPSILON >= item.purchaseQty);
  return { items, complete };
}

function projectState(materials = {}) {
  const items = purchaseMaterials(materials);
  const complete = items.length > 0 && items.every(item => receivedQuantity(item.material) + EPSILON >= item.purchaseQty);
  return { items, complete };
}

function signatureFor(items = []) {
  const source = items
    .map(item => `${item.id}:${Number(item.purchaseQty).toFixed(6)}`)
    .sort()
    .join('|');
  return createHash('sha256').update(source).digest('hex').slice(0, 24);
}

function safeKey(value = '') {
  return Buffer.from(String(value)).toString('base64url').slice(0, 100);
}

async function claimOnce(path, signature = '1') {
  const reference = getDatabase().ref(path);
  const result = await reference.transaction(current => {
    if (current?.signature === signature) return;
    return { signature, claimedAt: Date.now() };
  });
  return result.committed;
}

async function activeUsersAndTokens() {
  const database = getDatabase();
  const [usersSnapshot, tokensSnapshot] = await Promise.all([
    database.ref('users').get(),
    database.ref('pushTokens').get()
  ]);
  const users = usersSnapshot.val() || {};
  const tokenTree = tokensSnapshot.val() || {};
  const activeUsers = Object.entries(users)
    .filter(([, user]) => user?.active !== false)
    .map(([uid, user]) => ({ uid, ...user }));
  const tokens = [];
  activeUsers.forEach(user => {
    Object.entries(tokenTree[user.uid] || {}).forEach(([deviceId, device]) => {
      if (device?.enabled !== false && device?.token) {
        tokens.push({ uid: user.uid, deviceId, token: device.token });
      }
    });
  });
  return { activeUsers, tokens, users };
}

async function writeInternalNotification(notification, activeUsers, notificationId) {
  if (!activeUsers.length) return;
  const updates = {};
  activeUsers.forEach(user => {
    updates[`notifications/${user.uid}/${notificationId}`] = notification;
  });
  await getDatabase().ref().update(updates);
}

function tokenChunks(items, size = 500) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

async function sendPushNotification(notification, tokenEntries, collapseKey) {
  if (!tokenEntries.length) return;
  const invalidUpdates = {};
  for (const chunk of tokenChunks(tokenEntries)) {
    const response = await getMessaging().sendEachForMulticast({
      tokens: chunk.map(item => item.token),
      data: {
        notificationId: String(collapseKey),
        type: String(notification.type || ''),
        title: String(notification.title || 'Atualização do ObraFlow'),
        body: String(notification.body || ''),
        projectId: String(notification.projectId || ''),
        projectName: String(notification.projectName || ''),
        materialId: String(notification.materialId || ''),
        category: String(notification.category || ''),
        url: String(notification.url || './#estoque')
      },
      webpush: {
        headers: {
          Urgency: notification.type === 'receipt_partial' ? 'normal' : 'high',
          TTL: '86400'
        }
      }
    });

    response.responses.forEach((item, index) => {
      if (item.success) return;
      const code = item.error?.code || '';
      if (code === 'messaging/registration-token-not-registered'
        || code === 'messaging/invalid-registration-token') {
        const entry = chunk[index];
        invalidUpdates[`pushTokens/${entry.uid}/${entry.deviceId}`] = null;
      } else {
        logger.warn('Falha ao enviar uma notificação push.', { code, message: item.error?.message });
      }
    });
  }
  if (Object.keys(invalidUpdates).length) await getDatabase().ref().update(invalidUpdates);
}

async function dispatchNotification(notification, idSeed, { push = true } = {}) {
  const { activeUsers, tokens, users } = await activeUsersAndTokens();
  const actor = notification.actorId ? users[notification.actorId] : null;
  const completeNotification = {
    ...notification,
    actorName: actor?.name || '',
    createdAt: Date.now(),
    url: './#estoque'
  };
  const notificationId = safeKey(idSeed);
  await writeInternalNotification(completeNotification, activeUsers, notificationId);
  if (push) await sendPushNotification(completeNotification, tokens, notificationId);
}

exports.notifyMaterialReceipt = onValueWritten({
  ref: '/materials/{projectId}/{materialId}',
  instance: 'sistemsquared-default-rtdb'
}, async event => {
  if (!event.data.before.exists() || !event.data.after.exists()) return;

  const before = event.data.before.val() || {};
  const after = event.data.after.val() || {};
  const oldReceived = receivedQuantity(before);
  const newReceived = receivedQuantity(after);
  if (newReceived <= oldReceived + EPSILON) return;

  const { projectId, materialId } = event.params;
  const purchaseQty = allocation(after).purchaseQty;
  if (purchaseQty <= EPSILON) return;

  const database = getDatabase();
  const [projectSnapshot, materialsSnapshot] = await Promise.all([
    database.ref(`projects/${projectId}`).get(),
    database.ref(`materials/${projectId}`).get()
  ]);
  const project = projectSnapshot.val() || {};
  const materialsAfter = materialsSnapshot.val() || {};
  const materialsBefore = { ...materialsAfter, [materialId]: before };
  const projectName = project.name || project.code || 'Obra';
  const description = after.description || after.code || 'Material';
  const unit = after.unit || 'un';
  const category = materialCategory(after);
  const remaining = Math.max(0, purchaseQty - newReceived);
  const actorId = after.updatedBy || '';
  const eventKey = safeKey(event.id || `${projectId}-${materialId}-${after.updatedAt || Date.now()}`);

  const beforeCategory = categoryState(materialsBefore, category);
  const afterCategory = categoryState(materialsAfter, category);
  const beforeProject = projectState(materialsBefore);
  const afterProject = projectState(materialsAfter);

  let categoryClaimed = false;
  let categorySignature = '';
  let categoryKey = '';
  if (!beforeCategory.complete && afterCategory.complete) {
    categorySignature = signatureFor(afterCategory.items);
    categoryKey = safeKey(category);
    categoryClaimed = await claimOnce(
      `notificationMilestones/${projectId}/categories/${categoryKey}`,
      categorySignature
    );
  }

  let projectClaimed = false;
  let projectSignature = '';
  if (!beforeProject.complete && afterProject.complete) {
    projectSignature = signatureFor(afterProject.items);
    projectClaimed = await claimOnce(
      `notificationMilestones/${projectId}/allPurchases`,
      projectSignature
    );
  }

  const receiptClaimed = await claimOnce(`notificationDispatch/receipts/${eventKey}`, `${oldReceived}->${newReceived}`);
  if (receiptClaimed) {
    const completed = newReceived + EPSILON >= purchaseQty;
    await dispatchNotification({
      type: completed ? 'receipt_complete' : 'receipt_partial',
      title: completed ? 'Item completamente recebido' : 'Recebimento parcial',
      body: completed
        ? `${description}: ${formatQuantity(newReceived)} de ${formatQuantity(purchaseQty)} ${unit} recebidos.`
        : `${description}: ${formatQuantity(newReceived)} de ${formatQuantity(purchaseQty)} ${unit} recebidos. Faltam ${formatQuantity(remaining)} ${unit}.`,
      projectId,
      projectName,
      materialId,
      materialDescription: description,
      category,
      actorId,
      receivedQty: newReceived,
      purchaseQty,
      remainingQty: remaining,
      unit
    }, `receipt-${eventKey}`, { push: !categoryClaimed && !projectClaimed });
  }

  if (categoryClaimed) {
    await dispatchNotification({
      type: 'category_complete',
      title: 'Categoria completamente recebida',
      body: `Todos os ${afterCategory.items.length} itens de ${category} foram recebidos.`,
      projectId,
      projectName,
      materialId,
      category,
      actorId,
      itemCount: afterCategory.items.length
    }, `category-${projectId}-${categoryKey}-${categorySignature}`, { push: !projectClaimed });
  }

  if (projectClaimed) {
    await dispatchNotification({
      type: 'project_receipts_complete',
      title: 'Todos os materiais comprados foram recebidos',
      body: `${projectName}: os ${afterProject.items.length} itens de compra estão completamente recebidos.`,
      projectId,
      projectName,
      materialId,
      category,
      actorId,
      itemCount: afterProject.items.length
    }, `project-${projectId}-${projectSignature}`);
  }
});
