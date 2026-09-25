const cents = (value) => Math.round(Number(value || 0) * 100);
const euros = (value) => value / 100;

function addMonths(dateValue, offset) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + offset, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

export function componentSchedule(component, budgetYear) {
  if (Array.isArray(component.paymentSchedule) && component.paymentSchedule.length)
    return component.paymentSchedule;
  const payments = component.payments?.length === 4
    ? [0, 0, component.payments[0], 0, 0, component.payments[1], 0, 0, component.payments[2], 0, component.payments[3], 0]
    : component.payments || [];
  return payments.map((amount, index) => ({
    date: `${budgetYear}-${String(index + 1).padStart(2, "0")}-01`,
    principal: Number(amount) || 0,
    interest: 0,
  }));
}

export function annualPaymentSummary(component, year, budgetYear) {
  const principal = Array(12).fill(0);
  const interest = Array(12).fill(0);
  let paidPrincipal = 0;
  for (const payment of componentSchedule(component, budgetYear)) {
    const dueYear = Number(payment.date.slice(0, 4));
    const month = Number(payment.date.slice(5, 7)) - 1;
    if (dueYear <= year) paidPrincipal += cents(payment.principal);
    if (dueYear === year && month >= 0 && month < 12) {
      principal[month] += cents(payment.principal);
      interest[month] += cents(payment.interest);
    }
  }
  const cash = principal.map((amount, month) => euros(amount + interest[month]));
  return {
    cash,
    principal: euros(principal.reduce((sum, amount) => sum + amount, 0)),
    interest: euros(interest.reduce((sum, amount) => sum + amount, 0)),
    cashTotal: euros(principal.reduce((sum, amount) => sum + amount, 0) + interest.reduce((sum, amount) => sum + amount, 0)),
    remainingPrincipal: euros(Math.max(0, cents(component.approved + component.adjustment) - paidPrincipal)),
  };
}

export function annualDepreciation(component, year, budgetYear) {
  if (!component.inServiceDate)
    return year === budgetYear ? Number(component.depreciation || 0) : 0;
  const [startYear, startMonth] = component.inServiceDate.split("-").map(Number);
  const months = Number(component.life) * 12;
  if (!Number.isInteger(months) || months < 1) return 0;
  const amount = cents(component.approved + component.adjustment);
  let annualCents = 0;
  for (let month = 1; month <= 12; month++) {
    const offset = (year - startYear) * 12 + month - startMonth;
    if (offset >= 0 && offset < months)
      annualCents += Math.round((offset + 1) * amount / months) - Math.round(offset * amount / months);
  }
  return euros(annualCents);
}

export function generateInstallments({ mode, amount, firstDate, count, intervalMonths, annualRate }) {
  const principalCents = cents(amount);
  const installments = Number(count);
  const interval = Number(intervalMonths);
  const rate = Number(annualRate);
  if (!Number.isSafeInteger(principalCents) || principalCents <= 0 ||
      !Number.isInteger(installments) || installments < 1 || installments > 600 ||
      installments > principalCents || ![1, 3, 12].includes(interval) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(firstDate) ||
      !["fornitore", "finanziamento"].includes(mode) ||
      !Number.isFinite(rate) || rate < 0 || rate > 100)
    throw new Error("Controlla importo, prima scadenza, numero rate e tasso.");

  const periodicRate = mode === "finanziamento" ? rate / 100 * interval / 12 : 0;
  const fixedPayment = periodicRate
    ? Math.round(principalCents * periodicRate / (1 - (1 + periodicRate) ** -installments))
    : 0;
  let balance = principalCents;
  const schedule = [];
  for (let index = 0; index < installments; index++) {
    const interest = periodicRate ? Math.round(balance * periodicRate) : 0;
    const principal = index === installments - 1
      ? balance
      : periodicRate
        ? Math.max(1, Math.min(balance, fixedPayment - interest))
        : Math.round((index + 1) * principalCents / installments) -
          Math.round(index * principalCents / installments);
    balance -= principal;
    schedule.push({
      date: addMonths(firstDate, index * interval),
      principal: euros(principal),
      interest: euros(interest),
    });
  }
  return schedule;
}

export function scheduleTotals(schedule) {
  return schedule.reduce((total, payment) => ({
    principal: total.principal + cents(payment.principal),
    interest: total.interest + cents(payment.interest),
  }), { principal: 0, interest: 0 });
}
