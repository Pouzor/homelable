"""Every MCP tool is classified once and served with annotations, so clients
can tell read-only tools from destructive ones and from network scans."""
import pytest
from mcp.server import Server
from mcp.types import ListToolsRequest

from app.annotations import DESTRUCTIVE, OPEN_WORLD, READ_ONLY, WRITE, annotation_for
from app.tools import TOOLS, register_tools

CLASSES = {"read_only": READ_ONLY, "write": WRITE, "destructive": DESTRUCTIVE, "open_world": OPEN_WORLD}


def test_every_tool_is_classified_exactly_once():
    names = [t.name for t in TOOLS]
    assert len(names) == len(set(names))
    for name in names:
        hits = [cls for cls, members in CLASSES.items() if name in members]
        assert len(hits) == 1, f"{name}: {hits}"


def test_classification_lists_no_unknown_tool():
    names = {t.name for t in TOOLS}
    for cls, members in CLASSES.items():
        assert members <= names, f"{cls} lists unknown tools: {sorted(members - names)}"


def test_every_tool_carries_all_three_hints():
    for tool in TOOLS:
        a = tool.annotations
        assert a is not None, tool.name
        assert a.readOnlyHint is not None and a.destructiveHint is not None and a.openWorldHint is not None


def test_deletes_are_destructive():
    for tool in TOOLS:
        if tool.name.startswith("delete_"):
            assert tool.annotations.destructiveHint is True, tool.name
            assert tool.annotations.readOnlyHint is False, tool.name


def test_list_get_read_search_are_read_only():
    for tool in TOOLS:
        if tool.name.startswith(("list_", "get_", "read_", "search_")):
            assert tool.annotations.readOnlyHint is True, tool.name
            assert tool.annotations.openWorldHint is False, tool.name


def test_scans_are_open_world_and_not_read_only():
    by_name = {t.name: t for t in TOOLS}
    for name in ("trigger_scan", "rescan_device"):
        assert by_name[name].annotations.openWorldHint is True
        assert by_name[name].annotations.readOnlyHint is False


def test_scan_config_write_is_destructive():
    assert annotation_for("update_scan_config").destructiveHint is True


def test_destructive_and_open_world_sets_are_pinned_to_explicit_lists():
    # DESTRUCTIVE and OPEN_WORLD are curated allowlists, not derived
    # from naming conventions (unlike READ_ONLY's list_/get_/read_/search_
    # prefixes above) — pin the exact membership so a future edit to either
    # set is a deliberate, reviewed change, not an accidental drift.
    assert DESTRUCTIVE == {
        "delete_device", "delete_node", "delete_edge", "delete_design", "delete_rack",
        "unmount_device", "unpatch_cable", "set_device_faceplate", "update_scan_config",
    }
    assert OPEN_WORLD == {"trigger_scan", "rescan_device"}


def test_unclassified_tool_gets_the_most_cautious_hints_and_a_warning(caplog):
    # A tool added without a classification must not stop the server from
    # starting (the partition test above is what fails CI); until it is
    # classified, clients are told to treat it as destructive and open-world.
    with caplog.at_level("WARNING", logger="app.annotations"):
        a = annotation_for("brand_new_tool")
    assert (a.readOnlyHint, a.destructiveHint, a.openWorldHint) == (False, True, True)
    assert "brand_new_tool" in caplog.text


@pytest.mark.anyio
async def test_tools_list_handler_serves_annotations():
    server = Server("annotations-test")
    register_tools(server)
    result = await server.request_handlers[ListToolsRequest](ListToolsRequest(method="tools/list"))
    served = result.root.tools
    assert len(served) == len(TOOLS)
    assert all(t.annotations is not None for t in served)
