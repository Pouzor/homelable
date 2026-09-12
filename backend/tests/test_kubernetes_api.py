async def test_kubernetes_status_and_topology_are_authenticated_and_disabled_by_default(client, headers):
    unauthenticated = await client.get("/api/v1/kubernetes/status")
    unauthenticated_sync = await client.post("/api/v1/kubernetes/sync")
    status = await client.get("/api/v1/kubernetes/status", headers=headers)
    topology = await client.get("/api/v1/kubernetes/topology", headers=headers)
    sync = await client.post("/api/v1/kubernetes/sync", headers=headers)

    assert unauthenticated.status_code == 401
    assert unauthenticated_sync.status_code == 401
    assert status.status_code == 200
    assert status.json() == {
        "enabled": False,
        "configured": False,
        "state": "disabled",
        "last_success_at": None,
        "last_attempt_at": None,
        "last_error": None,
        "object_count": 0,
        "relationship_count": 0,
    }
    assert topology.status_code == 200
    body = topology.json()
    assert body["schemaVersion"] == 1
    assert body["sync"]["state"] == "disabled"
    assert body["objects"] == []
    assert body["relationships"] == []
    assert sync.status_code == 200
    assert sync.json()["state"] == "disabled"
