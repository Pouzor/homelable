from datetime import datetime

from pydantic import BaseModel


class SnmpOidConfig(BaseModel):
    oid: str
    label: str


class SnmpMetricOut(BaseModel):
    oid: str
    label: str | None
    value: str | None
    value_type: str | None
    polled_at: datetime

    model_config = {"from_attributes": True}


class SnmpDeviceConfig(BaseModel):
    snmp_enabled: bool
    snmp_community: str
    snmp_version: str
    snmp_port: int
    snmp_oids: list[SnmpOidConfig]


class LldpNeighbor(BaseModel):
    local_port_num: int | None = None
    chassis_id: str | None = None
    port_id: str | None = None
    port_desc: str | None = None
    sys_name: str | None = None
    sys_desc: str | None = None


class TopologyDiscoveryResult(BaseModel):
    neighbors: list[LldpNeighbor]
    edges_created: int
