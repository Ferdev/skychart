#!/usr/bin/env python3
"""Prototype exact sorted ID lookup with bounded external merge and seeks.

Version 1: 16-byte header (8-byte magic, uint64 count), then little-endian
uint64 source ID + uint32 locator. Locator: file[14], row group[5], offset[12].
Source release/schema hashes belong in the accompanying immutable receipt.
This measures an ID component only, not aliases, angular tiles or full serving.
"""
import heapq
from pathlib import Path
import os
import struct

HEADER=struct.Struct('<8sQ');RECORD=struct.Struct('<QI');MAGIC=b'SCID001\0'


def locator(file_id,group,offset):
    if not (0<=file_id<16384 and 0<=group<32 and 0<=offset<4096):
        raise ValueError('locator cannot represent source row')
    return (file_id<<17)|(group<<12)|offset


def unpack_locator(value):
    if not 0<=value<2**31:raise ValueError('invalid locator')
    return value>>17,(value>>12)&31,value&4095


def write_run(path,items,checkpoint=None):
    part=path.with_suffix(path.suffix+'.partial');count=0;prior=None
    with part.open('wb') as f:
        f.write(HEADER.pack(MAGIC,0))
        for key,position in items:
            if checkpoint is not None and count%65536==0:checkpoint()
            if type(key) is not int or not 0<=key<2**64:raise ValueError('unrepresentable source ID')
            unpack_locator(position)
            if prior is not None and key<=prior:raise ValueError('duplicate or unsorted source ID')
            f.write(RECORD.pack(key,position));prior=key;count+=1
        f.seek(0);f.write(HEADER.pack(MAGIC,count));f.flush();os.fsync(f.fileno())
    part.replace(path);return count


def header(f):
    raw=f.read(HEADER.size)
    if len(raw)!=HEADER.size:raise ValueError('truncated header')
    magic,count=HEADER.unpack(raw)
    if magic!=MAGIC:raise ValueError('unsupported lookup version')
    if os.fstat(f.fileno()).st_size!=HEADER.size+RECORD.size*count:raise ValueError('truncated or trailing data')
    return count


def read_run(path):
    with path.open('rb') as f:
        count=header(f);prior=None
        for _ in range(count):
            key,position=RECORD.unpack(f.read(RECORD.size));unpack_locator(position)
            if prior is not None and key<=prior:raise ValueError('invalid sorted run')
            prior=key;yield key,position


def merge(paths,output,checkpoint=None):
    if not paths or len(paths)>64:raise ValueError('merge fan-in must be 1..64')
    if output.resolve() in {p.resolve() for p in paths}:raise ValueError('merge cannot overwrite input')
    return write_run(output,heapq.merge(*(read_run(p) for p in paths)),checkpoint)


def lookup(path,key):
    with path.open('rb') as f:
        lo=0;hi=header(f)
        while lo<hi:
            mid=(lo+hi)//2;f.seek(HEADER.size+mid*RECORD.size)
            found,position=RECORD.unpack(f.read(RECORD.size))
            if found==key:return unpack_locator(position)
            if found<key:lo=mid+1
            else:hi=mid
    return None
