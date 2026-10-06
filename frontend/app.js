const COGNITO_DOMAIN =
  "cloud-finops-446241389794.auth.ap-southeast-2.amazoncognito.com";

const CLIENT_ID =
  "j5jrhs91i14qucet78528cm5o";

const API_URL =
  "https://hpon9ihfbc.execute-api.ap-southeast-2.amazonaws.com/prod/dashboard";

const REDIRECT_URI =
  window.location.origin;


const $ = id =>
  document.getElementById(id);


const loginScreen =
  $("loginScreen");

const dashboardScreen =
  $("dashboardScreen");

const loginButton =
  $("loginButton");

const logoutButton =
  $("logoutButton");

const refreshButton =
  $("refreshButton");


function clearTokens() {

  [
    "access_token",
    "id_token",
    "refresh_token"
  ].forEach(key =>
    localStorage.removeItem(key)
  );

}


function token() {

  return (
    localStorage.getItem("id_token") ||
    localStorage.getItem("access_token")
  );

}


function showLogin() {

  if (loginScreen) {
    loginScreen.classList.remove("hidden");
  }

  if (dashboardScreen) {
    dashboardScreen.classList.add("hidden");
  }

}


function showDashboard() {

  if (loginScreen) {
    loginScreen.classList.add("hidden");
  }

  if (dashboardScreen) {
    dashboardScreen.classList.remove("hidden");
  }

}


function login() {

  const url =
    `https://${COGNITO_DOMAIN}/oauth2/authorize` +
    `?client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent("openid email profile")}` +
    `&prompt=login` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

  window.location.href = url;

}


async function exchangeCode(code) {

  const body =
    new URLSearchParams({
      grant_type:
        "authorization_code",

      client_id:
        CLIENT_ID,

      code,

      redirect_uri:
        REDIRECT_URI
    });


  const response =
    await fetch(
      `https://${COGNITO_DOMAIN}/oauth2/token`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded"
        },

        body:
          body.toString()
      }
    );


  if (!response.ok) {

    throw new Error(
      `Cognito token exchange failed: ${response.status}`
    );

  }


  const tokens =
    await response.json();


  if (tokens.access_token) {

    localStorage.setItem(
      "access_token",
      tokens.access_token
    );

  }


  if (tokens.id_token) {

    localStorage.setItem(
      "id_token",
      tokens.id_token
    );

  }


  if (tokens.refresh_token) {

    localStorage.setItem(
      "refresh_token",
      tokens.refresh_token
    );

  }

}


function setStatus(
  text,
  connected = false
) {

  const status =
    $("connectionStatus");

  const sidebar =
    $("sidebarConnection");


  if (status) {

    status.innerHTML =
      `<span class="green-dot"></span>${text}`;

    status.classList.toggle(
      "connected",
      connected
    );

  }


  if (sidebar) {

    sidebar.textContent =
      connected
        ? "Connected"
        : text;

  }

}


function set(
  id,
  value
) {

  const element =
    $(id);

  if (element) {

    element.textContent =
      String(value);

  }

}


function esc(value) {

  return String(value)

    .replaceAll(
      "&",
      "&amp;"
    )

    .replaceAll(
      "<",
      "&lt;"
    )

    .replaceAll(
      ">",
      "&gt;"
    )

    .replaceAll(
      '"',
      "&quot;"
    )

    .replaceAll(
      "'",
      "&#039;"
    );

}


function money(value) {

  return `$${Number(
    value || 0
  ).toFixed(2)}`;

}


async function loadDashboard() {

  const currentToken =
    token();


  if (!currentToken) {

    showLogin();
    return;

  }


  setStatus(
    "Connecting...",
    false
  );


  try {

    const response =
      await fetch(
        API_URL,
        {
          method: "GET",

          headers: {
            Authorization:
              `Bearer ${currentToken}`,

            Accept:
              "application/json"
          }
        }
      );


    if (response.status === 401) {

      clearTokens();

      setStatus(
        "Session expired",
        false
      );

      showLogin();

      return;

    }


    if (!response.ok) {

      throw new Error(
        `Dashboard API returned ${response.status}`
      );

    }


    const data =
      await response.json();


    updateDashboard(data);


    setStatus(
      "Connected",
      true
    );


  } catch (error) {

    console.error(
      "Dashboard error:",
      error
    );

    setStatus(
      "Connection error",
      false
    );

  }

}


function updateDashboard(data) {

  const summary =
    data.summary || {};

  const resources =
    data.resources || {};

  const scan =
    data.latestScan || {};

  const cost =
    data.latestCostAnalysis || {};

  const issues =
    data.issues || [];


  set(
    "currentCost",
    money(summary.currentCost)
  );


  set(
    "previousCost",
    money(summary.previousCost)
  );


  set(
    "percentageChange",
    `${Number(
      summary.percentageChange || 0
    ).toFixed(0)}%`
  );


  const savings =
    Number(
      summary.estimatedMonthlySavings || 0
    );


  set(
    "estimatedSavings",
    money(savings)
  );


  set(
    "savingsTotal",
    money(savings)
  );


  set(
    "annualSavings",
    money(savings * 12)
  );


  set(
    "ec2Instances",
    resources.ec2Instances || 0
  );


  set(
    "stoppedInstances",
    resources.stoppedInstances || 0
  );


  set(
    "ebsVolumes",
    resources.ebsVolumes || 0
  );


  set(
    "unattachedEbsVolumes",
    resources.unattachedEbsVolumes || 0
  );


  set(
    "elasticIps",
    resources.elasticIps || 0
  );


  set(
    "unusedElasticIps",
    resources.unusedElasticIps || 0
  );


  const currentTrend =
    cost.trend ||
    summary.trend ||
    "STABLE";


  set(
    "trend",
    currentTrend
  );


  set(
    "trendBadge",
    currentTrend
  );


  set(
    "anomaly",
    cost.anomalyDetected
      ? "Anomaly detected"
      : "No anomaly"
  );


  set(
    "currency",
    cost.currency ||
      "USD"
  );


  set(
    "latestScan",
    scan.scannedAt
      ? new Date(
          scan.scannedAt
        ).toLocaleString()
      : "No scan available"
  );


  set(
    "issueCount",
    issues.length
  );


  const score =
    Math.max(
      0,
      Math.min(
        100,

        100 -

        (
          Number(
            resources.stoppedInstances || 0
          ) * 8
        ) -

        (
          Number(
            resources.unattachedEbsVolumes || 0
          ) * 10
        ) -

        (
          Number(
            resources.unusedElasticIps || 0
          ) * 8
        ) -

        (
          issues.length * 4
        )

      )
    );


  set(
    "finopsScore",
    Math.round(score)
  );


  set(
    "finopsScoreLabel",

    score < 50
      ? "Critical"
      : score < 70
        ? "Attention"
        : score < 90
          ? "Good"
          : "Excellent"
  );


  set(
    "finopsScoreDescription",

    score < 50
      ? "Significant optimization opportunities require attention."

      : score < 70
        ? "Several resources may require FinOps review."

        : score < 90
          ? "A few optimization opportunities have been identified."

          : "Your monitored AWS environment currently has a healthy FinOps posture."
  );


  const ring =
    document.querySelector(
      ".score-ring"
    );


  if (ring) {

    ring.style.background =
      `conic-gradient(
        #4ade80 0 ${score}%,
        #163322 ${score}% 100%
      )`;

  }


  renderIssues(issues);

  renderSavings(issues);

  renderActivity(issues);

}


function renderIssues(issues) {

  const container =
    $("issuesContainer");


  if (!container) {
    return;
  }


  if (!issues.length) {

    container.innerHTML =
      `
      <div class="empty">
        No optimization issues detected.
        Your AWS environment currently has
        no detected FinOps issues.
      </div>
      `;

    return;

  }


  container.innerHTML =
    issues
      .map(issue => {

        const savings =
          issue.estimatedMonthlySavings ??
          issue.estimatedMonthlySaving ??
          0;


        return `
          <div class="issue">

            <strong>
              ${esc(
                issue.type ||
                "Optimization Issue"
              )}
            </strong>

            <p>
              ${esc(
                issue.description ||
                "Optimization opportunity detected."
              )}
            </p>

            <p>
              <b>Recommendation:</b>
              ${esc(
                issue.recommendation ||
                "Review this resource."
              )}
            </p>

            <span class="issue-saving">
              Potential savings:
              ${money(savings)}
              / month
            </span>

            <p>
              Resource:
              ${esc(
                issue.resourceId ||
                "N/A"
              )}
            </p>

          </div>
        `;

      })
      .join("");

}


function renderSavings(issues) {

  const container =
    $("savingsBreakdown");


  if (!container) {
    return;
  }


  if (!issues.length) {

    container.innerHTML =
      `
      <div class="empty">
        No active savings opportunities.
      </div>
      `;

    return;

  }


  const groups = {};


  issues.forEach(issue => {

    const type =
      issue.type ||
      "OTHER";


    const value =
      Number(
        issue.estimatedMonthlySavings ??
        issue.estimatedMonthlySaving ??
        0
      );


    groups[type] =
      (groups[type] || 0) +
      value;

  });


  const max =
    Math.max(
      ...Object.values(groups),
      1
    );


  container.innerHTML =
    Object.entries(groups)
      .map(
        ([type, value]) => {

          const width =
            Math.max(
              6,
              (value / max) * 100
            );


          return `
            <div
              style="
                display:grid;
                grid-template-columns:110px 1fr 65px;
                gap:10px;
                align-items:center;
                margin:12px 0;
              "
            >

              <span
                style="
                  color:#7d8b9f;
                  font-size:9px;
                "
              >
                ${esc(
                  type.replaceAll(
                    "_",
                    " "
                  )
                )}
              </span>

              <div
                style="
                  height:7px;
                  background:#17221f;
                  border-radius:99px;
                  overflow:hidden;
                "
              >

                <div
                  style="
                    height:100%;
                    width:${width}%;
                    background:#4ade80;
                  "
                ></div>

              </div>

              <b
                style="
                  color:#86efac;
                  font-size:9px;
                  text-align:right;
                "
              >
                ${money(value)}
              </b>

            </div>
          `;

        }
      )
      .join("");

}


function renderActivity(issues) {

  const container =
    $("activityContainer");


  if (!container) {
    return;
  }


  if (!issues.length) {

    container.innerHTML =
      `
      <div class="empty">
        Optimization activity will appear here
        when automated actions are recorded.
      </div>
      `;

    return;

  }


  container.innerHTML =
    issues
      .slice(0, 5)
      .map(issue => {

        const date =
          issue.detectedAt
            ? new Date(
                issue.detectedAt
              ).toLocaleString()
            : "Recently";


        return `
          <div class="activity">

            <div class="feature-icon green"></div>

            <div>

              <strong>
                ${esc(
                  issue.type ||
                  "Optimization"
                )}
              </strong>

              <span>
                ${esc(
                  issue.resourceId ||
                  "Resource detected"
                )}
              </span>

            </div>

            <time>
              ${esc(date)}
            </time>

          </div>
        `;

      })
      .join("");

}


function logout() {

  clearTokens();

  showLogin();

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });

}


if (loginButton) {

  loginButton.addEventListener(
    "click",
    login
  );

}


if (logoutButton) {

  logoutButton.addEventListener(
    "click",
    logout
  );

}


if (refreshButton) {

  refreshButton.addEventListener(
    "click",
    loadDashboard
  );

}


document
  .querySelectorAll(".sidebar-link")
  .forEach(link => {

    link.addEventListener(
      "click",
      () => {

        document
          .querySelectorAll(
            ".sidebar-link"
          )
          .forEach(item =>
            item.classList.remove(
              "active"
            )
          );


        link.classList.add(
          "active"
        );

      }
    );

  });


(async function initialize() {

  const params =
    new URLSearchParams(
      window.location.search
    );


  const code =
    params.get("code");


  if (code) {

    try {

      await exchangeCode(
        code
      );


      window.history.replaceState(
        {},
        document.title,
        window.location.pathname
      );


    } catch (error) {

      console.error(
        "Login error:",
        error
      );

      clearTokens();

      showLogin();

      return;

    }

  }


  if (token()) {

    showDashboard();

    await loadDashboard();

  } else {

    showLogin();

  }


  setInterval(
    () => {

      if (token()) {
        loadDashboard();
      }

    },
    300000
  );

})();
