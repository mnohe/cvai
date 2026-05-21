import unittest
from pathlib import Path
import sys
from unittest import mock
import json
import urllib.error

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cvai_core.llm import LLMConfig, OpenAIAPIError, OpenAIClient


class OpenAIClientErrorTests(unittest.TestCase):
    def test_client_reads_generic_llm_environment(self) -> None:
        with mock.patch.dict(
            "os.environ",
            {"LLM_API_KEY": "key", "LLM_MODEL": "model", "LLM_BASE_URL": "https://llm.example/v1"},
            clear=True,
        ):
            client = OpenAIClient()

        self.assertEqual(client.config.api_key, "key")
        self.assertEqual(client.config.model, "model")
        self.assertEqual(client.config.base_url, "https://llm.example/v1")

    def test_insufficient_quota_error_is_human_friendly(self) -> None:
        client = OpenAIClient(LLMConfig(api_key="test", model="gpt-5", base_url="https://api.openai.com/v1"))

        error = client._build_api_error(
            429,
            """
            {
              "error": {
                "message": "You exceeded your current quota, please check your plan and billing details.",
                "type": "insufficient_quota",
                "param": null,
                "code": "insufficient_quota"
              }
            }
            """,
        )

        self.assertIsInstance(error, OpenAIAPIError)
        self.assertEqual(error.status_code, 429)
        self.assertEqual(error.error_code, "insufficient_quota")
        self.assertIn("quota is exhausted", error.user_message)

    def test_invalid_key_error_is_human_friendly(self) -> None:
        client = OpenAIClient(LLMConfig(api_key="test", model="gpt-5", base_url="https://api.openai.com/v1"))

        error = client._build_api_error(
            401,
            """
            {
              "error": {
                "message": "Incorrect API key provided.",
                "type": "invalid_request_error",
                "param": null,
                "code": "invalid_api_key"
              }
            }
            """,
        )

        self.assertIsInstance(error, OpenAIAPIError)
        self.assertEqual(error.status_code, 401)
        self.assertIn("key was rejected", error.user_message)

    def test_missing_api_key_is_reported_before_http_call(self) -> None:
        client = OpenAIClient(LLMConfig(api_key="", model="gpt-5", base_url="https://api.openai.com/v1"))

        with self.assertRaisesRegex(RuntimeError, "LLM_API_KEY"):
            client._json_chat("Return json.", {}, 10)

    def test_generic_rate_limit_and_server_errors_are_human_friendly(self) -> None:
        client = OpenAIClient(LLMConfig(api_key="test", model="gpt-5", base_url="https://api.openai.com/v1"))

        rate_limited = client._build_api_error(429, '{"error":{"message":"slow down","type":"rate_limit"}}')
        server_error = client._build_api_error(500, '{"error":{"message":"broken","type":"server_error"}}')

        self.assertIn("rate-limited", rate_limited.user_message)
        self.assertIn("HTTP 500", server_error.user_message)
        self.assertIn("broken", server_error.user_message)

    def test_json_chat_parses_successful_response(self) -> None:
        client = OpenAIClient(LLMConfig(api_key="test", model="gpt-5", base_url="https://llm.example/v1"))

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            def read(self):
                return json.dumps({"choices": [{"message": {"content": "{\"ok\": true}"}}]}).encode("utf-8")

        with mock.patch("cvai_core.llm.urllib.request.urlopen", return_value=FakeResponse()) as urlopen:
            result = client._json_chat("Return JSON.", {"hello": "world"}, 10)

        self.assertEqual(result, {"ok": True})
        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://llm.example/v1/chat/completions")

    def test_json_chat_wraps_http_and_url_errors(self) -> None:
        client = OpenAIClient(LLMConfig(api_key="test", model="gpt-5", base_url="https://llm.example/v1"))
        http_error = urllib.error.HTTPError(
            "https://llm.example/v1/chat/completions",
            401,
            "Unauthorized",
            {},
            None,
        )
        http_error.fp = mock.Mock()
        http_error.fp.read.return_value = b'{"error":{"code":"invalid_api_key","message":"bad"}}'

        with mock.patch("cvai_core.llm.urllib.request.urlopen", side_effect=http_error):
            with self.assertRaises(OpenAIAPIError) as raised:
                client._json_chat("Return JSON.", {}, 10)
        self.assertEqual(raised.exception.status_code, 401)

        with mock.patch("cvai_core.llm.urllib.request.urlopen", side_effect=urllib.error.URLError("offline")):
            with self.assertRaises(OpenAIAPIError) as raised:
                client._json_chat("Return JSON.", {}, 10)
        self.assertIn("could not be reached", raised.exception.user_message)

    def test_json_chat_reports_malformed_api_shape_and_bad_json_content(self) -> None:
        client = OpenAIClient(LLMConfig(api_key="test", model="gpt-5", base_url="https://llm.example/v1"))

        class FakeResponse:
            def __init__(self, payload: dict) -> None:
                self.payload = payload

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return None

            def read(self):
                return json.dumps(self.payload).encode("utf-8")

        with mock.patch("cvai_core.llm.urllib.request.urlopen", return_value=FakeResponse({"choices": []})):
            with self.assertRaisesRegex(RuntimeError, "Unexpected"):
                client._json_chat("Return JSON.", {}, 10)

        with mock.patch(
            "cvai_core.llm.urllib.request.urlopen",
            return_value=FakeResponse({"choices": [{"message": {"content": "not-json"}}]}),
        ):
            with self.assertRaises(json.JSONDecodeError):
                client._json_chat("Return JSON.", {}, 10)


if __name__ == "__main__":
    unittest.main()
