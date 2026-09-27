# AI provider balances and spending

Squad Bots shows billing on each provider card. Set the billing mode under **Edit billing & provider** to prepaid credits or pay as you go. Unconfigured providers remain **Billing not set**; the application does not infer an account's billing arrangement from its API type. All amounts are USD.

Apply `supabase/migrations/20260927180000_ai_provider_billing.sql` before deploying the server and admin UI. The added settings column inherits the existing server-only grants and RLS. No inference/gateway changes are required.

## Automatic reporting

| Provider | Credit balance | Spend | Server variable |
| --- | --- | --- | --- |
| Anthropic | Manual snapshot | Organization cost report, current UTC calendar month (excludes Priority Tier) | `ANTHROPIC_ADMIN_API_KEY` |
| OpenAI | Manual snapshot | Organization cost report, current UTC calendar month | `OPENAI_ADMIN_API_KEY` |
| OpenRouter | Account credits purchased minus credits used | Current calendar month for the configured inference API key | `OPENROUTER_MANAGEMENT_API_KEY` for credits; existing inference key for spend |
| Other/custom endpoint | Manual snapshot | Manual snapshot | None |

For standard inference variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`), the matching billing variable is used automatically. For another account, create a dedicated variable such as `AI_SECOND_ACCOUNT_BILLING_API_KEY` and select its name under **Billing key variable**. The billing key must belong to the same account as the inference key. Only environment variable names are saved in the database or returned to the client.

Billing calls use fixed official endpoints and reject redirects; custom inference endpoints never receive billing credentials. Reports load independently of bot controls, time out after ten seconds, and are cached for one minute. The view refreshes every five minutes while open and provides a Refresh button. Disabled providers retain their billing visibility.

Organization totals can include activity outside SquadHub and overlap if several configured providers use the same organization. OpenRouter key spending is labeled separately from account credits; key spending limits are never presented as prepaid balances. Provider reporting can lag, and amounts are usage costs, not invoices including taxes. A valid empty report shows $0; missing credentials, failed requests, malformed reports, and incomplete pagination never manufacture a zero.

## Manual figures

Expand **Record billing figures manually**, enter the balance and/or month-to-date spend from the provider console, and set **Figures as of (UTC)**. Spend refers to the start of that date's calendar month through the recorded time. Each metric remains labeled **Manual · as of**; earlier months show their actual month and a previous-month notice. Saving unrelated provider settings does not refresh the timestamp. Clear both fields to remove a snapshot. Automatic figures take priority for each metric independently. A failed automatic refresh may fall back to the dated manual record with an explanation.

## API references

- [Anthropic Usage and Cost API](https://platform.claude.com/docs/en/manage-claude/usage-cost-api): admin access, decimal cents, daily buckets, pagination.
- [OpenAI Usage and Costs](https://platform.openai.com/docs/api-reference/usage/costs): admin organization reports and monetary amounts.
- [OpenRouter account credits](https://openrouter.ai/docs/api/api-reference/credits/get-credits): management key, purchased and used credits.
- [OpenRouter API key usage](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key): monthly key usage.
