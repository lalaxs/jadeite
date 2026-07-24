export function patchRecruitDetailView(root, {
  candidateId,
  detailHtml,
  footerHtml
}) {
  const body = root?.querySelector("[data-recruit-detail-body]");
  if (!body) return;
  if (body.dataset.candidateId !== candidateId) {
    body.dataset.candidateId = candidateId;
    body.innerHTML = detailHtml;
  }
  const footer = root.querySelector("[data-recruit-footer]");
  if (footer && footer.innerHTML !== footerHtml) footer.innerHTML = footerHtml;
}
