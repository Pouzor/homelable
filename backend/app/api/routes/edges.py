from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.database import get_db
from app.db.models import Edge
from app.schemas.edges import EdgeCreate, EdgeResponse, EdgeUpdate

router = APIRouter()


@router.get("", response_model=list[EdgeResponse])
async def list_edges(db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)):
    result = await db.execute(select(Edge))
    return result.scalars().all()


@router.post("", response_model=EdgeResponse, status_code=status.HTTP_201_CREATED)
async def create_edge(body: EdgeCreate, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)):
    edge = Edge(**body.model_dump())
    db.add(edge)
    await db.commit()
    await db.refresh(edge)
    return edge


@router.delete("/{edge_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_edge(edge_id: str, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)):
    edge = await db.get(Edge, edge_id)
    if not edge:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Edge not found")
    await db.delete(edge)
    await db.commit()


@router.patch("/{edge_id}", response_model=EdgeResponse)
async def update_edge(
    edge_id: str, body: EdgeUpdate, db: AsyncSession = Depends(get_db), _: str = Depends(get_current_user)
):
    edge = await db.get(Edge, edge_id)
    if not edge:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Edge not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(edge, field, value)
    await db.commit()
    await db.refresh(edge)
    return edge
