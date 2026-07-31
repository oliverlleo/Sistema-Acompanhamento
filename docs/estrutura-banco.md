# Estrutura do Realtime Database

```text
users/{uid}
  name
  email
  role: gerente | compras | almoxarifado | producao | operador
  active

projects/{projectId}
  id
  code
  name
  client
  address
  deadline
  manager
  status
  notes

materials/{projectId}/{materialId}
  id
  projectId
  code
  description
  category
  type
  color
  dimensions
  qtyRequired
  unit
  source: compra | estoque
  supplier
  orderNumber
  purchaseDate
  deliveryEta
  qtyReceived
  receivedDate
  stockReservedQty
  stockItemCode
  stockLocation
  paintingRequired
  paintingSupplier
  paintingSentDate
  paintingEta
  paintingSentQty
  paintingReturnedQty
  paintingReturnDate
  separatedQty
  separatedDate
  siteDeliveredQty
  siteDeliveredDate
  status
  notes
  sourceDetails

projectSummaries/{projectId}
  total
  completed
  pending
  comprar
  aguardandoEntrega
  comprasAtrasadas
  pintura
  pinturaAtrasada
  separar
  separados
  enviados
  progress

activities/{projectId}/{activityId}
  type
  message
  materialId
  userId
  userName
  createdAt

inventory/{itemId}
  id
  code
  description
  category
  qtyAvailable
  minQty
  unit
  location
  notes
```

## Status calculados dos materiais

- `comprar`
- `reservar_estoque`
- `aguardando_entrega`
- `compra_atrasada`
- `recebido_parcial`
- `aguarda_pintura`
- `em_pintura`
- `pintura_atrasada`
- `pronto_separar`
- `separado_parcial`
- `separado`
- `enviado_parcial`
- `enviado_obra`

O status é recalculado sempre que uma movimentação é salva e também periodicamente para identificar prazos vencidos.
