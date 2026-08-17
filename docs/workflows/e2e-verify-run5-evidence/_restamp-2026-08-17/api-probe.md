# API restamp 2026-08-17T20:31:08.710Z

## closer (login 200 role=closer)
- GET /api/read/my-numbers → 200 ok
- GET /api/repair/exceptions → 403 role_forbidden
- GET /api/read/banking-surface → 403 forbidden
- GET /api/inquiry?action=cases → 403 forbidden
- GET /api/read/staff?limit=5 → 403 forbidden
- GET /api/read/invoices?limit=5 → 403 forbidden
- GET /api/read/failed-events?limit=5 → 403 forbidden
- GET /api/read/commissions?limit=5 → 403 forbidden
- GET /api/read/messages?status=blocked&limit=5 → 200 ok
- GET /api/demo/mode → 403 forbidden
- GET /api/campaigns/list → 400 partner_id_required
- POST /api/read/company-brain-affiliate → 403 forbidden

## funding_advisor (login 200 role=funding_advisor)
- GET /api/read/my-numbers → 403 forbidden
- GET /api/repair/exceptions → 403 role_forbidden
- GET /api/read/banking-surface → 403 forbidden
- GET /api/inquiry?action=cases → 403 forbidden
- GET /api/read/staff?limit=5 → 403 forbidden
- GET /api/read/invoices?limit=5 → 403 forbidden
- GET /api/read/failed-events?limit=5 → 403 forbidden
- GET /api/read/commissions?limit=5 → 403 forbidden
- GET /api/read/messages?status=blocked&limit=5 → 200 ok
- GET /api/demo/mode → 403 forbidden
- GET /api/campaigns/list → 400 partner_id_required
- POST /api/read/company-brain-affiliate → 403 forbidden

## inquiry_specialist (login 200 role=inquiry_specialist)
- GET /api/read/my-numbers → 403 forbidden
- GET /api/repair/exceptions → 403 role_forbidden
- GET /api/read/banking-surface → 403 forbidden
- GET /api/inquiry?action=cases → 503 not_configured
- GET /api/read/staff?limit=5 → 403 forbidden
- GET /api/read/invoices?limit=5 → 403 forbidden
- GET /api/read/failed-events?limit=5 → 403 forbidden
- GET /api/read/commissions?limit=5 → 403 forbidden
- GET /api/read/messages?status=blocked&limit=5 → 200 ok
- GET /api/demo/mode → 403 forbidden
- GET /api/campaigns/list → 400 partner_id_required
- POST /api/read/company-brain-affiliate → 403 forbidden

## sales_manager (login 200 role=sales_manager)
- GET /api/read/my-numbers → 200 ok
- GET /api/repair/exceptions → 403 role_forbidden
- GET /api/read/banking-surface → 403 banking surface requires plaid configuration
- GET /api/inquiry?action=cases → 403 forbidden
- GET /api/read/staff?limit=5 → 200 ok
- GET /api/read/invoices?limit=5 → 200 ok
- GET /api/read/failed-events?limit=5 → 403 forbidden
- GET /api/read/commissions?limit=5 → 200 ok
- GET /api/read/messages?status=blocked&limit=5 → 200 ok
- GET /api/demo/mode → 403 forbidden
- GET /api/campaigns/list → 400 partner_id_required
- POST /api/read/company-brain-affiliate → 403 forbidden

## owner (login 200 role=owner)
- GET /api/read/my-numbers → 200 ok
- GET /api/repair/exceptions → 200 ok
- GET /api/read/banking-surface → 403 banking surface requires plaid configuration
- GET /api/inquiry?action=cases → 503 not_configured
- GET /api/read/staff?limit=5 → 200 ok
- GET /api/read/invoices?limit=5 → 200 ok
- GET /api/read/failed-events?limit=5 → 200 ok
- GET /api/read/commissions?limit=5 → 200 ok
- GET /api/read/messages?status=blocked&limit=5 → 200 ok
- GET /api/demo/mode → 200 ok
- GET /api/campaigns/list → 400 partner_id_required
- POST /api/read/company-brain-affiliate → 403 forbidden

## client (login 200 role=client)
- GET /api/read/my-numbers → 401 unauthorized
- GET /api/repair/exceptions → 403 forbidden
- GET /api/read/banking-surface → 401 unauthorized
- GET /api/inquiry?action=cases → 401 unauthorized
- GET /api/read/staff?limit=5 → 401 unauthorized
- GET /api/read/invoices?limit=5 → 401 unauthorized
- GET /api/read/failed-events?limit=5 → 401 unauthorized
- GET /api/read/commissions?limit=5 → 401 unauthorized
- GET /api/read/messages?status=blocked&limit=5 → 401 unauthorized
- GET /api/demo/mode → 401 unauthorized
- GET /api/campaigns/list → 403 forbidden
- POST /api/read/company-brain-affiliate → 403 forbidden

## affiliate (login 200 role=affiliate)
- GET /api/read/my-numbers → 401 unauthorized
- GET /api/repair/exceptions → 403 forbidden
- GET /api/read/banking-surface → 401 unauthorized
- GET /api/inquiry?action=cases → 401 unauthorized
- GET /api/read/staff?limit=5 → 401 unauthorized
- GET /api/read/invoices?limit=5 → 401 unauthorized
- GET /api/read/failed-events?limit=5 → 401 unauthorized
- GET /api/read/commissions?limit=5 → 401 unauthorized
- GET /api/read/messages?status=blocked&limit=5 → 401 unauthorized
- GET /api/demo/mode → 401 unauthorized
- GET /api/campaigns/list → 403 forbidden
- POST /api/read/company-brain-affiliate → 400 question_required

## partner (login 200 role=partner)
- GET /api/read/my-numbers → 401 unauthorized
- GET /api/repair/exceptions → 403 forbidden
- GET /api/read/banking-surface → 401 unauthorized
- GET /api/inquiry?action=cases → 401 unauthorized
- GET /api/read/staff?limit=5 → 401 unauthorized
- GET /api/read/invoices?limit=5 → 401 unauthorized
- GET /api/read/failed-events?limit=5 → 401 unauthorized
- GET /api/read/commissions?limit=5 → 401 unauthorized
- GET /api/read/messages?status=blocked&limit=5 → 401 unauthorized
- GET /api/demo/mode → 401 unauthorized
- GET /api/campaigns/list → 200 ok
- POST /api/read/company-brain-affiliate → 400 question_required
