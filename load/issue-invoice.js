// k6 load test: each virtual user creates a draft and issues it through the real server actions
// (docs/load-test.md). Run against a local production build with local Postgres, never Vercel.
//
//   docker run --rm -i -v "$PWD/load:/load" -e BASE_URL=http://host.docker.internal:3000 \
//     grafana/k6:1.4.0 run /load/issue-invoice.js
import { check, sleep } from "k6";
import http from "k6/http";
import { Trend } from "k6/metrics";

const users = JSON.parse(open("./.users.json"));
const actions = JSON.parse(open("./.actions.json"));
const BASE = __ENV.BASE_URL || "http://host.docker.internal:3000";

export const options = {
  scenarios: {
    issue: { executor: "constant-vus", vus: users.length, duration: __ENV.DURATION || "1m" },
  },
  thresholds: {
    // SPEC §6.1: issuing feels instant on a phone.
    issue_ms: ["p(95)<1000"],
    create_ms: ["p(95)<1000"],
    checks: ["rate>0.99"],
  },
};

const createMs = new Trend("create_ms", true);
const issueMs = new Trend("issue_ms", true);

/** A zero-rated one-off line: the invoice is valid without products or customers. */
const DRAFT = {
  customerId: null,
  lines: [
    {
      productId: null,
      description: "Load test item",
      hsnSac: "",
      unit: "NOS",
      qty: "2",
      unitPrice: "150",
      discount: "",
      rateBp: 0,
      priceIncludesTax: false,
    },
  ],
};

/** Calls a server action the way the browser does and returns its `{ ok, data | error }`. */
function callAction(user, page, actionId, args, name) {
  const response = http.post(`${BASE}${page}`, JSON.stringify(args), {
    headers: {
      "Next-Action": actionId,
      "Content-Type": "text/plain;charset=UTF-8",
      Accept: "text/x-component",
      Origin: BASE,
      Cookie: user.cookie,
    },
    tags: { name },
  });
  // The reply is React's stream format: one "<id>:<json>" line is the action's result.
  const line = (response.body || "").split("\n").find((text) => text.includes('"ok":'));
  const result = line ? JSON.parse(line.slice(line.indexOf(":") + 1)) : null;
  return { response, result };
}

export default function issueOneInvoice() {
  const user = users[(__VU - 1) % users.length];
  const page = `/b/${user.slug}/invoices/new`;

  const created = callAction(
    user,
    page,
    actions.createDraftAction,
    [user.slug, DRAFT],
    "createDraft",
  );
  createMs.add(created.response.timings.duration);
  const draftOk = check(created, {
    "draft created": (c) => c.response.status === 200 && c.result && c.result.ok === true,
  });
  if (!draftOk) {
    sleep(1);
    return;
  }

  const { id, version } = created.result.data;
  const issued = callAction(
    user,
    page,
    actions.issueInvoiceAction,
    [user.slug, id, { version, acknowledgedWarnings: [] }],
    "issueInvoice",
  );
  issueMs.add(issued.response.timings.duration);
  check(issued, {
    "invoice issued": (c) =>
      c.response.status === 200 &&
      c.result &&
      c.result.ok === true &&
      c.result.data.status === "issued",
  });

  // A person takes a moment between invoices; this also keeps each user under the 120 changes
  // a minute limit (two changes per invoice).
  sleep(1.5);
}
