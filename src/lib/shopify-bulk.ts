import { shopifyGraphQL, type ShopifyCred } from "@/lib/shopify";

// ============================================================================
//  SHOPIFY — BULK PRODUCT ACTIONS (Manage Products · Shopify → "More actions")
//  Các thao tác hàng loạt chạy THẲNG trên Shopify qua GraphQL Admin API:
//   - Lifecycle: set status ACTIVE / DRAFT (Unlist) / ARCHIVED, xoá hẳn (productDelete)
//   - Sales channels (publications): include / exclude
//   - Catalogs: include / exclude  (catalog = publication ở Admin API)
//   - Tags: add / remove
//   - Collections (manual): add / remove
//  Mọi hàm gom userErrors thành throw để route log lỗi rõ ràng.
// ============================================================================

type UserErr = { field?: string[] | null; message?: string };
const throwUserErrors = (label: string, errs: UserErr[] | undefined) => {
  if (errs && errs.length) throw new Error(`${label}: ${errs.map((e) => e.message).filter(Boolean).join("; ").slice(0, 300)}`);
};

// ---- Danh sách để build picker (sales channels / catalogs / collections) ----
export async function listPublications(cred: ShopifyCred): Promise<{ id: string; name: string }[]> {
  const d = await shopifyGraphQL<{ publications?: { edges?: { node?: { id: string; name?: string } }[] } }>(
    cred,
    `query { publications(first: 50) { edges { node { id name } } } }`,
  );
  return (d.publications?.edges ?? []).map((e) => ({ id: String(e.node?.id ?? ""), name: String(e.node?.name ?? "Channel") })).filter((p) => p.id);
}

export async function listCatalogs(cred: ShopifyCred): Promise<{ id: string; name: string; publicationId: string }[]> {
  // Catalog (Markets / B2B) — mỗi catalog có 1 publication để publish/unpublish sản phẩm.
  const d = await shopifyGraphQL<{ catalogs?: { edges?: { node?: { id: string; title?: string; publication?: { id?: string } } }[] } }>(
    cred,
    `query { catalogs(first: 50) { edges { node { id title publication { id } } } } }`,
  ).catch(() => ({ catalogs: { edges: [] } }));
  return (d.catalogs?.edges ?? [])
    .map((e) => ({ id: String(e.node?.id ?? ""), name: String(e.node?.title ?? "Catalog"), publicationId: String(e.node?.publication?.id ?? "") }))
    .filter((c) => c.publicationId);
}

export async function listCustomCollections(cred: ShopifyCred): Promise<{ id: string; title: string }[]> {
  // Chỉ collection THỦ CÔNG (manual) mới add/remove product được; smart collection Shopify tự lọc.
  const d = await shopifyGraphQL<{ collections?: { edges?: { node?: { id: string; title?: string } }[] } }>(
    cred,
    `query { collections(first: 250, query: "collection_type:custom") { edges { node { id title } } } }`,
  );
  return (d.collections?.edges ?? []).map((e) => ({ id: String(e.node?.id ?? ""), title: String(e.node?.title ?? "Collection") })).filter((c) => c.id);
}

// ---- Lifecycle ----
export async function setProductStatus(cred: ShopifyCred, gid: string, status: "ACTIVE" | "DRAFT" | "ARCHIVED"): Promise<void> {
  const d = await shopifyGraphQL<{ productUpdate?: { userErrors?: UserErr[] } }>(
    cred,
    `mutation($input: ProductInput!) { productUpdate(input: $input) { product { id status } userErrors { field message } } }`,
    { input: { id: gid, status } },
  );
  throwUserErrors("productUpdate", d.productUpdate?.userErrors);
}

export async function deleteProduct(cred: ShopifyCred, gid: string): Promise<void> {
  const d = await shopifyGraphQL<{ productDelete?: { deletedProductId?: string; userErrors?: UserErr[] } }>(
    cred,
    `mutation($input: ProductDeleteInput!) { productDelete(input: $input) { deletedProductId userErrors { field message } } }`,
    { input: { id: gid } },
  );
  throwUserErrors("productDelete", d.productDelete?.userErrors);
}

// ---- Tags ----
export async function addTags(cred: ShopifyCred, gid: string, tags: string[]): Promise<void> {
  const d = await shopifyGraphQL<{ tagsAdd?: { userErrors?: UserErr[] } }>(
    cred,
    `mutation($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { field message } } }`,
    { id: gid, tags },
  );
  throwUserErrors("tagsAdd", d.tagsAdd?.userErrors);
}

export async function removeTags(cred: ShopifyCred, gid: string, tags: string[]): Promise<void> {
  const d = await shopifyGraphQL<{ tagsRemove?: { userErrors?: UserErr[] } }>(
    cred,
    `mutation($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { field message } } }`,
    { id: gid, tags },
  );
  throwUserErrors("tagsRemove", d.tagsRemove?.userErrors);
}

// ---- Sales channels / Catalogs (publications) ----
export async function publishToPublications(cred: ShopifyCred, gid: string, publicationIds: string[]): Promise<void> {
  const d = await shopifyGraphQL<{ publishablePublish?: { userErrors?: UserErr[] } }>(
    cred,
    `mutation($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { userErrors { field message } } }`,
    { id: gid, input: publicationIds.map((publicationId) => ({ publicationId })) },
  );
  throwUserErrors("publishablePublish", d.publishablePublish?.userErrors);
}

export async function unpublishFromPublications(cred: ShopifyCred, gid: string, publicationIds: string[]): Promise<void> {
  const d = await shopifyGraphQL<{ publishableUnpublish?: { userErrors?: UserErr[] } }>(
    cred,
    `mutation($id: ID!, $input: [PublicationInput!]!) { publishableUnpublish(id: $id, input: $input) { userErrors { field message } } }`,
    { id: gid, input: publicationIds.map((publicationId) => ({ publicationId })) },
  );
  throwUserErrors("publishableUnpublish", d.publishableUnpublish?.userErrors);
}

// ---- Collections (manual) — thao tác theo collection, nhận cả list product 1 lần ----
// Trả về { id, title } của collection để route cập nhật NGAY cột collections local
// (không chờ Sync) — nếu không, bảng vẫn hiện "—" dù Shopify đã nhận.
export async function collectionAddProducts(cred: ShopifyCred, collectionId: string, productIds: string[]): Promise<{ id: string; title: string }> {
  const d = await shopifyGraphQL<{ collectionAddProducts?: { collection?: { id?: string; title?: string } | null; userErrors?: UserErr[] } }>(
    cred,
    `mutation($id: ID!, $productIds: [ID!]!) { collectionAddProducts(id: $id, productIds: $productIds) { collection { id title } userErrors { field message } } }`,
    { id: collectionId, productIds },
  );
  throwUserErrors("collectionAddProducts", d.collectionAddProducts?.userErrors);
  const c = d.collectionAddProducts?.collection;
  return { id: String(c?.id || collectionId), title: String(c?.title || "Collection") };
}

export async function collectionRemoveProducts(cred: ShopifyCred, collectionId: string, productIds: string[]): Promise<void> {
  const d = await shopifyGraphQL<{ collectionRemoveProducts?: { userErrors?: UserErr[] } }>(
    cred,
    `mutation($id: ID!, $productIds: [ID!]!) { collectionRemoveProducts(id: $id, productIds: $productIds) { job { id } userErrors { field message } } }`,
    { id: collectionId, productIds },
  );
  throwUserErrors("collectionRemoveProducts", d.collectionRemoveProducts?.userErrors);
}
