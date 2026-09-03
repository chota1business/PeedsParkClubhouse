// PeedsPark Admin — shared search + date-range + pagination controls, reused
// across every list page (Bookings, Pool & Badminton, Manager Feed,
// Enquiries, Customers) so the behaviour and markup are identical everywhere
// instead of five slightly-different copies.
//
// Usage per page (see bookings.js etc. for real examples):
//   const listControls = createListControls({
//     searchInputId: "bookingSearch",
//     dateFromId: "bookingDateFrom",
//     dateToId: "bookingDateTo",
//     pagerContainerId: "bookingPager",
//     searchText: (row) => `${row.customer_name} ${row.phone}`,
//     dateField: (row) => row.booking_date, // "YYYY-MM-DD" or null/undefined
//     pageSize: 15,
//     onChange: renderBookings,
//   });
//   // inside renderBookings():
//   let rows = allBookings;
//   if (activeFilter !== "all") rows = rows.filter(...);
//   rows = listControls.apply(rows); // search + date range
//   const page = listControls.paginate(rows);
//   container.innerHTML = page.rows.map(bookingRowHtml).join("");
//   listControls.renderPager(page.totalItems);

function createListControls(opts) {
  const state = { search: "", dateFrom: "", dateTo: "", page: 1 };
  const pageSize = opts.pageSize || 15;

  const searchInput = opts.searchInputId ? document.getElementById(opts.searchInputId) : null;
  const dateFromInput = opts.dateFromId ? document.getElementById(opts.dateFromId) : null;
  const dateToInput = opts.dateToId ? document.getElementById(opts.dateToId) : null;
  const pagerContainer = opts.pagerContainerId ? document.getElementById(opts.pagerContainerId) : null;

  function resetPageAndNotify() {
    state.page = 1;
    opts.onChange?.();
  }

  searchInput?.addEventListener("input", () => {
    state.search = searchInput.value.trim().toLowerCase();
    resetPageAndNotify();
  });
  dateFromInput?.addEventListener("change", () => {
    state.dateFrom = dateFromInput.value || "";
    resetPageAndNotify();
  });
  dateToInput?.addEventListener("change", () => {
    state.dateTo = dateToInput.value || "";
    resetPageAndNotify();
  });

  // Search (name/phone, via opts.searchText) + date range (via opts.dateField).
  // A row with no date (opts.dateField returns null/undefined) always passes
  // the date filter — we never hide a record just because it has no date.
  function apply(rows) {
    let out = rows;
    if (state.search && opts.searchText) {
      out = out.filter((r) => (opts.searchText(r) || "").toLowerCase().includes(state.search));
    }
    if ((state.dateFrom || state.dateTo) && opts.dateField) {
      out = out.filter((r) => {
        const d = opts.dateField(r);
        if (!d) return true;
        if (state.dateFrom && d < state.dateFrom) return false;
        if (state.dateTo && d > state.dateTo) return false;
        return true;
      });
    }
    return out;
  }

  function paginate(rows) {
    const totalItems = rows.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    if (state.page > totalPages) state.page = totalPages;
    if (state.page < 1) state.page = 1;
    const start = (state.page - 1) * pageSize;
    return { rows: rows.slice(start, start + pageSize), totalItems, totalPages, page: state.page };
  }

  function renderPager(totalItems) {
    if (!pagerContainer) return;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    if (totalItems === 0) {
      pagerContainer.innerHTML = "";
      return;
    }
    if (totalPages <= 1) {
      pagerContainer.innerHTML = `<span class="muted small">${totalItems} result${totalItems === 1 ? "" : "s"}</span>`;
      return;
    }
    pagerContainer.innerHTML = `
      <button type="button" class="btn btn-outline-dark btn-sm" data-page-nav="prev" ${state.page <= 1 ? "disabled" : ""}>&larr; Prev</button>
      <span class="muted small" style="margin:0 10px;">Page ${state.page} of ${totalPages} &middot; ${totalItems} result${totalItems === 1 ? "" : "s"}</span>
      <button type="button" class="btn btn-outline-dark btn-sm" data-page-nav="next" ${state.page >= totalPages ? "disabled" : ""}>Next &rarr;</button>
    `;
    pagerContainer.querySelector('[data-page-nav="prev"]')?.addEventListener("click", () => {
      state.page = Math.max(1, state.page - 1);
      opts.onChange?.();
    });
    pagerContainer.querySelector('[data-page-nav="next"]')?.addEventListener("click", () => {
      state.page = Math.min(totalPages, state.page + 1);
      opts.onChange?.();
    });
  }

  // Call when the underlying data reloads (e.g. after a fresh fetch), so a
  // stale page number from before doesn't leave the list looking empty.
  function resetPage() {
    state.page = 1;
  }

  return { apply, paginate, renderPager, resetPage };
}
