const AWS_REGION = "ap-southeast-2";

const USER_POOL_ID =
  "ap-southeast-2_taBz5Decq";

const CLIENT_ID =
  "j5jrhs91i14qucet78528cm5o";

const COGNITO_DOMAIN =
  "cloud-finops-446241389794.auth.ap-southeast-2.amazoncognito.com";

const API_URL =
  "https://hpon9ihfbc.execute-api.ap-southeast-2.amazonaws.com/prod/dashboard";

const REDIRECT_URI =
  window.location.origin;


// =====================================================
// DOM
// =====================================================

const loginButton =
  document.getElementById("loginButton");

const logoutButton =
  document.getElementById("logoutButton");

const refreshButton =
  document.getElementById("refreshButton");

const loginScreen =
  document.getElementById("loginScreen");

const dashboardScreen =
  document.getElementById("dashboardScreen");

const connectionStatus =
  document.getElementById("connectionStatus");

const sidebarConnection =
  document.getElementById("sidebarConnection");


// =====================================================
// KPI
// =====================================================

const currentCost =
  document.getElementById("currentCost");

const previousCost =
  document.getElementById("previousCost");

const percentageChange =
  document.getElementById("percentageChange");

const estimatedSavings =
  document.getElementById("estimatedSavings");


// =====================================================
// RESOURCES
// =====================================================

const ec2Instances =
  document.getElementById("ec2Instances");

const stoppedInstances =
  document.getElementById("stoppedInstances");

const ebsVolumes =
  document.getElementById("ebsVolumes");

const unattachedEbsVolumes =
  document.getElementById(
    "unattachedEbsVolumes"
  );

const elasticIps =
  document.getElementById("elasticIps");

const unusedElasticIps =
  document.getElementById(
    "unusedElasticIps"
  );


// =====================================================
// ANALYSIS
// =====================================================

const trendBadge =
  document.getElementById("trendBadge");

const trend =
  document.getElementById("trend");

const anomaly =
  document.getElementById("anomaly");

const currency =
  document.getElementById("currency");


// =====================================================
// MONITORING
// =====================================================

const latestScan =
  document.getElementById("latestScan");

const issueCount =
  document.getElementById("issueCount");

const issuesContainer =
  document.getElementById("issuesContainer");


// =====================================================
// NEW UI
// =====================================================

const finopsScore =
  document.getElementById("finopsScore");

const finopsScoreLabel =
  document.getElementById(
    "finopsScoreLabel"
  );

const finopsScoreDescription =
  document.getElementById(
    "finopsScoreDescription"
  );

const savingsTotal =
  document.getElementById(
    "savingsTotal"
  );

const annualSavings =
  document.getElementById(
    "annualSavings"
  );

const savingsBreakdown =
  document.getElementById(
    "savingsBreakdown"
  );

const activityContainer =
  document.getElementById(
    "activityContainer"
  );


// =====================================================
// SCREEN CONTROL
// =====================================================

function showLoginScreen() {
  if (loginScreen) {
    loginScreen.style.display = "flex";
  }

  if (dashboardScreen) {
    dashboardScreen.style.display = "none";
  }
}


function showDashboardScreen() {
  if (loginScreen) {
    loginScreen.style.display = "none";
  }

  if (dashboardScreen) {
    dashboardScreen.style.display = "flex";
  }
}


// =====================================================
// CONNECTION STATUS
// =====================================================

function setConnectionStatus(
  message,
  connected = false
) {
  if (!connectionStatus) {
    return;
  }

  connectionStatus.innerHTML = `
    <span class="status-dot"></span>
    <span>${escapeHtml(message)}</span>
  `;

  connectionStatus.classList.toggle(
    "connected",
    connected
  );

  if (sidebarConnection) {
    sidebarConnection.textContent =
      connected
        ? "Connected"
        : message;
  }
}


// =====================================================
// COGNITO LOGIN
// =====================================================

function login() {
  const loginUrl =
    `https://${COGNITO_DOMAIN}/oauth2/authorize` +
    `?client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(
      "openid email profile"
    )}` +
    `&redirect_uri=${encodeURIComponent(
      REDIRECT_URI
    )}`;

  window.location.href = loginUrl;
}


// =====================================================
// TOKEN EXCHANGE
// =====================================================

async function exchangeCodeForTokens(code) {

  const tokenUrl =
    `https://${COGNITO_DOMAIN}/oauth2/token`;

  const body =
    new URLSearchParams();

  body.append(
    "grant_type",
    "authorization_code"
  );

  body.append(
    "client_id",
    CLIENT_ID
  );

  body.append(
    "code",
    code
  );

  body.append(
    "redirect_uri",
    REDIRECT_URI
  );


  const response =
    await fetch(tokenUrl, {
      method: "POST",

      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded",
      },

      body: body.toString(),
    });


  if (!response.ok) {

    const errorText =
      await response.text();

    throw new Error(
      `Cognito token exchange failed: ${response.status} ${errorText}`
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


  return tokens;
}


// =====================================================
// TOKENS
// =====================================================

function clearTokens() {

  localStorage.removeItem(
    "access_token"
  );

  localStorage.removeItem(
    "id_token"
  );

  localStorage.removeItem(
    "refresh_token"
  );
}


function getApiToken() {

  return (
    localStorage.getItem("id_token") ||
    localStorage.getItem("access_token")
  );
}


// =====================================================
// DASHBOARD API
// =====================================================

async function loadDashboard() {

  const token =
    getApiToken();


  if (!token) {
    showLoginScreen();
    return;
  }


  setConnectionStatus(
    "Connecting...",
    false
  );


  try {

    const response =
      await fetch(API_URL, {
        method: "GET",

        headers: {
          Authorization:
            `Bearer ${token}`,

          Accept:
            "application/json",
        },
      });


    if (response.status === 401) {

      clearTokens();

      setConnectionStatus(
        "Session expired",
        false
      );

      showLoginScreen();

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


    setConnectionStatus(
      "Connected",
      true
    );

  } catch (error) {

    console.error(
      "Dashboard error:",
      error
    );

    setConnectionStatus(
      "Connection error",
      false
    );
  }
}


// =====================================================
// DASHBOARD UPDATE
// =====================================================

function updateDashboard(data) {

  const summary =
    data.summary || {};

  const resources =
    data.resources || {};

  const scan =
    data.latestScan || {};

  const costAnalysis =
    data.latestCostAnalysis || {};

  const issues =
    data.issues || [];


  // ===================================================
  // KPI
  // ===================================================

  setText(
    currentCost,
    `$${Number(
      summary.currentCost || 0
    ).toFixed(2)}`
  );

  setText(
    previousCost,
    `$${Number(
      summary.previousCost || 0
    ).toFixed(2)}`
  );

  setText(
    percentageChange,
    `${Number(
      summary.percentageChange || 0
    ).toFixed(0)}%`
  );

  const totalSavings =
    Number(
      summary.estimatedMonthlySavings || 0
    );


  setText(
    estimatedSavings,
    `$${totalSavings.toFixed(2)}`
  );

  setText(
    savingsTotal,
    `$${totalSavings.toFixed(2)}`
  );

  setText(
    annualSavings,
    `$${(totalSavings * 12).toFixed(2)}`
  );


  // ===================================================
  // RESOURCES
  // ===================================================

  setText(
    ec2Instances,
    resources.ec2Instances || 0
  );

  setText(
    stoppedInstances,
    resources.stoppedInstances || 0
  );

  setText(
    ebsVolumes,
    resources.ebsVolumes || 0
  );

  setText(
    unattachedEbsVolumes,
    resources.unattachedEbsVolumes || 0
  );

  setText(
    elasticIps,
    resources.elasticIps || 0
  );

  setText(
    unusedElasticIps,
    resources.unusedElasticIps || 0
  );


  // ===================================================
  // COST ANALYSIS
  // ===================================================

  const currentTrend =
    costAnalysis.trend ||
    summary.trend ||
    "STABLE";

  setText(
    trend,
    currentTrend
  );

  setText(
    trendBadge,
    currentTrend
  );


  const anomalyDetected =
    Boolean(
      costAnalysis.anomalyDetected
    );


  setText(
    anomaly,
    anomalyDetected
      ? "Anomaly detected"
      : "No anomaly"
  );


  setText(
    currency,
    costAnalysis.currency ||
      "USD"
  );


  // ===================================================
  // LATEST SCAN
  // ===================================================

  setText(
    latestScan,
    scan.scannedAt
      ? new Date(
          scan.scannedAt
        ).toLocaleString()
      : "No scan available"
  );


  // ===================================================
  // ISSUES
  // ===================================================

  setText(
    issueCount,
    issues.length
  );


  renderIssues(
    issues
  );


  // ===================================================
  // SAVINGS
  // ===================================================

  renderSavings(
    issues
  );


  // ===================================================
  // FINOPS SCORE
  // ===================================================

  calculateFinOpsScore(
    resources,
    issues
  );


  // ===================================================
  // ACTIVITY
  // ===================================================

  renderActivity(
    issues
  );
}


// =====================================================
// FINOPS SCORE
// =====================================================

function calculateFinOpsScore(
  resources,
  issues
) {

  let score = 100;


  const stopped =
    Number(
      resources.stoppedInstances || 0
    );

  const unattached =
    Number(
      resources.unattachedEbsVolumes || 0
    );

  const unusedIps =
    Number(
      resources.unusedElasticIps || 0
    );


  score -= stopped * 8;
  score -= unattached * 10;
  score -= unusedIps * 8;
  score -= issues.length * 4;


  score =
    Math.max(
      0,
      Math.min(
        100,
        score
      )
    );


  setText(
    finopsScore,
    Math.round(score)
  );


  let label =
    "Excellent";

  let description =
    "Your monitored AWS environment currently has a healthy FinOps posture.";


  if (score < 90) {

    label =
      "Good";

    description =
      "A few optimization opportunities have been identified.";
  }


  if (score < 70) {

    label =
      "Attention";

    description =
      "Several resources may require FinOps review.";
  }


  if (score < 50) {

    label =
      "Critical";

    description =
      "Significant optimization opportunities require attention.";
  }


  setText(
    finopsScoreLabel,
    label
  );

  setText(
    finopsScoreDescription,
    description
  );


  const ring =
    document.querySelector(
      ".score-ring"
    );


  if (ring) {

    const degrees =
      score * 3.6;

    ring.style.background =
      `conic-gradient(
        #4ade80 0deg,
        #4ade80 ${degrees}deg,
        rgba(74, 222, 128, 0.08) ${degrees}deg,
        rgba(74, 222, 128, 0.08) 360deg
      )`;
  }
}


// =====================================================
// OPTIMIZATION ISSUES
// =====================================================

function renderIssues(
  issues
) {

  if (!issuesContainer) {
    return;
  }


  if (!issues.length) {

    issuesContainer.innerHTML = `
      <div class="empty-state">

        <div class="empty-icon">
          ✓
        </div>

        <div>

          <strong>
            No optimization issues detected
          </strong>

          <p>
            Your AWS environment currently has
            no detected FinOps issues.
          </p>

        </div>

      </div>
    `;

    return;
  }


  issuesContainer.innerHTML =
    issues
      .map(
        (issue) => {

          const severity =
            issue.severity ||
            "INFO";


          const savings =
            Number(
              issue.estimatedMonthlySavings ||
              issue.estimatedMonthlySaving ||
              0
            ).toFixed(2);


          return `
            <div class="issue-card">

              <div class="issue-header">

                <strong>
                  ${escapeHtml(
                    issue.type ||
                    "Optimization Issue"
                  )}
                </strong>

                <span class="issue-severity">
                  ${escapeHtml(
                    severity
                  )}
                </span>

              </div>


              <p>
                ${escapeHtml(
                  issue.description ||
                  "Optimization opportunity detected."
                )}
              </p>


              <p>
                <strong>
                  Recommendation:
                </strong>
                ${escapeHtml(
                  issue.recommendation ||
                  "Review this resource."
                )}
              </p>


              <div class="issue-savings">
                Potential savings:
                $${savings} / month
              </div>


              <div class="issue-resource">
                Resource:
                ${escapeHtml(
                  issue.resourceId ||
                  "N/A"
                )}
              </div>

            </div>
          `;
        }
      )
      .join("");
}


// =====================================================
// SAVINGS BREAKDOWN
// =====================================================

function renderSavings(
  issues
) {

  if (!savingsBreakdown) {
    return;
  }


  if (!issues.length) {

    savingsBreakdown.innerHTML = `
      <div class="savings-empty">
        No active savings opportunities.
      </div>
    `;

    return;
  }


  const grouped = {};


  issues.forEach(
    (issue) => {

      const type =
        issue.type ||
        "OTHER";


      const savings =
        Number(
          issue.estimatedMonthlySavings ||
          issue.estimatedMonthlySaving ||
          0
        );


      grouped[type] =
        (grouped[type] || 0) +
        savings;
    }
  );


  const entries =
    Object.entries(
      grouped
    );


  const maxValue =
    Math.max(
      ...entries.map(
        ([, value]) => value
      ),
      1
    );


  savingsBreakdown.innerHTML =
    entries
      .map(
        ([type, value]) => {

          const width =
            Math.max(
              6,
              (value / maxValue) * 100
            );


          return `
            <div class="savings-row">

              <span class="savings-row-label">
                ${escapeHtml(
                  formatIssueType(type)
                )}
              </span>

              <div class="savings-bar-track">
                <div
                  class="savings-bar-fill"
                  style="width:${width}%"
                ></div>
              </div>

              <span class="savings-row-value">
                $${value.toFixed(2)}
              </span>

            </div>
          `;
        }
      )
      .join("");
}


// =====================================================
// ACTIVITY
// =====================================================

function renderActivity(
  issues
) {

  if (!activityContainer) {
    return;
  }


  const activity =
    issues.slice(
      0,
      5
    );


  if (!activity.length) {

    activityContainer.innerHTML = `
      <div class="activity-empty">
        Optimization activity will appear here
        when automated actions are recorded.
      </div>
    `;

    return;
  }


  activityContainer.innerHTML =
    activity
      .map(
        (issue) => {

          const date =
            issue.detectedAt
              ? new Date(
                  issue.detectedAt
                ).toLocaleString()
              : "Recently";


          return `
            <div class="activity-item">

              <div class="activity-icon">
                ↯
              </div>

              <div class="activity-info">

                <strong>
                  ${escapeHtml(
                    formatIssueType(
                      issue.type ||
                      "Optimization"
                    )
                  )}
                </strong>

                <span>
                  ${escapeHtml(
                    issue.resourceId ||
                    "Resource detected"
                  )}
                </span>

              </div>

              <span class="activity-time">
                ${escapeHtml(date)}
              </span>

            </div>
          `;
        }
      )
      .join("");
}


// =====================================================
// HELPERS
// =====================================================

function formatIssueType(
  type
) {

  return String(type)
    .replaceAll(
      "_",
      " "
    )
    .toLowerCase()
    .replace(
      /\b\w/g,
      (letter) =>
        letter.toUpperCase()
    );
}


function setText(
  element,
  value
) {

  if (element) {
    element.textContent =
      String(value);
  }
}


function escapeHtml(
  value
) {

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


// =====================================================
// LOGOUT
// =====================================================

function logout() {

  clearTokens();


  const logoutUrl =
    `https://${COGNITO_DOMAIN}/logout` +
    `?client_id=${encodeURIComponent(
      CLIENT_ID
    )}` +
    `&logout_uri=${encodeURIComponent(
      REDIRECT_URI
    )}`;


  window.location.href =
    logoutUrl;
}


// =====================================================
// SIDEBAR ACTIVE LINKS
// =====================================================

function initializeNavigation() {

  const links =
    document.querySelectorAll(
      ".sidebar-link"
    );


  links.forEach(
    (link) => {

      link.addEventListener(
        "click",
        () => {

          links.forEach(
            (item) =>
              item.classList.remove(
                "active"
              )
          );


          link.classList.add(
            "active"
          );
        }
      );

    }
  );
}


// =====================================================
// INITIALIZATION
// =====================================================

async function initialize() {

  const params =
    new URLSearchParams(
      window.location.search
    );


  const code =
    params.get("code");


  if (code) {

    try {

      await exchangeCodeForTokens(
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

      showLoginScreen();

      return;
    }
  }


  const token =
    getApiToken();


  if (token) {

    showDashboardScreen();

    await loadDashboard();

  } else {

    showLoginScreen();
  }


  initializeNavigation();
}


// =====================================================
// EVENTS
// =====================================================

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


initialize();


// =====================================================
// AUTO REFRESH
// =====================================================

setInterval(
  () => {

    if (getApiToken()) {
      loadDashboard();
    }

  },
  5 * 60 * 1000
);