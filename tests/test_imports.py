"""Run from the repository root: python -m unittest discover -s tests."""
import base64
import io
import json
import time
import unittest
import urllib.parse
from unittest.mock import patch
import zipfile

import canva_connect as canva
import deck
import server

TEMPLATE = next(t for t in server.TEMPLATES if t.get("kind") == "deck")
RAW = (server.WEB / "builtin" / (TEMPLATE["id"] + ".pptx")).read_bytes()

class TemplateTests(unittest.TestCase):
    def test_fill_preserves_original_and_maps_fields(self):
        rows = deck.inspect(RAW)
        deck.bindings_ok(rows, TEMPLATE["bindings"])
        fields = {"name":"Sample Applicant", "email":"demo@example.org", "education":"Example degree"}
        items = [{"mode":"short","name":"Example project","short":"Delivered a prototype"}]
        result = deck.fill(RAW, TEMPLATE["bindings"], {"fields":fields,"items":items}, None)
        text = "\n".join(r["text"] for r in deck.inspect(result))
        self.assertIn("Sample Applicant", text)
        self.assertIn("Delivered a prototype", text)
        self.assertIn("Example degree", text)
        self.assertNotIn("Sample Applicant", str(rows))
        self.assertTrue(all(not r["picture"] for r in deck.inspect(result)))

    def test_snapshot_and_bad_mapping(self):
        encoded = base64.b64encode(RAW).decode()
        record = {"id":"user-00000000-0000-4000-a000-000000000000","name":"Demo",
                  "blob":encoded,"bindings":TEMPLATE["bindings"]}
        s = dict(projects=[],drafts=[],userTemplates=[record])
        server.check_state(json.loads(json.dumps(s)))
        self.assertTrue(server.catalog(s)[-1]["usesPortrait"])
        record["bindings"] = {"99:999":"name"}
        with self.assertRaises(ValueError): server.check_state(s)

    def test_macro_package_rejected(self):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream,"w") as z: z.writestr("ppt/vbaProject.bin",b"")
        with self.assertRaises(ValueError): deck.inspect(stream.getvalue())

    def test_oauth_session_exchanges_and_downloads(self):
        callback = "http://127.0.0.1:18430/canva/callback"
        start = canva.begin(dict(link="https://www.canva.com/design/DEMO123/edit",
                                 clientId="sample",clientSecret="fixture"),callback)
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(start["authorize"]).query)
        self.assertEqual(query["redirect_uri"],[callback])
        self.assertEqual(query["scope"],["design:content:read"])
        self.assertIn("code_challenge",query)
        with self.assertRaises(ValueError): canva.callback({"state":["invalid"]})
        replies = [{"access_token":"fixture"},{"job":{"status":"in_progress","id":"demo"}},
                   {"job":{"status":"success","urls":["https://export-download.canva.com/demo"]}}]
        with patch.object(canva,"request_json",side_effect=replies) as api, patch.object(canva,"download",return_value=RAW):
            canva.callback({"state":query["state"],"code":["example"]})
            for _ in range(80):
                response = canva.poll(start["ticket"])
                if response["status"]=="ready": break
                time.sleep(.05)
            self.assertEqual(base64.b64decode(response["blob"]),RAW)
            self.assertEqual(json.loads(api.call_args_list[1][0][1])["design_id"],"DEMO123")
        with self.assertRaises(ValueError): canva.poll(start["ticket"])

if __name__=="__main__": unittest.main()
