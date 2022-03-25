import json
import asyncio
import math
from math import sin, cos

from ably import AblyRest
import logging
import msgpack
import faust
from faust import Record
from aiokafka.helpers import create_ssl_context

from datetime import datetime
from typing import Optional, Union, Any, List, Dict

from orjson import orjson
from pydantic import BaseModel

import numpy as np
import json
from json import JSONEncoder


class update_points(Record, serializer='json'):
    x: int
    y: int


class ably_msg(Record, serializer='json'):
    id: str
    name: str
    connectionId: str
    timestamp: int
    data: str  # List[updates_points]


class ably_env(Record, serializer='json'):
    source: str
    appId: str
    channel: str
    site: str
    ruleId: str
    messages: List[ably_msg]


client = AblyRest('GQNJEg.EjiPfg:euDWQbHrvBEbszTBZYC6Re72ZQLidm21h6dbVWk0g9M')

channel = client.channels.get('outbound')
logger = logging.getLogger('ably')
logger.addHandler(logging.StreamHandler())
logging.getLogger('ably').setLevel(logging.WARNING)
logging.getLogger('ably.rest.auth').setLevel(logging.INFO)

context = create_ssl_context(
    capath="~/certs",
    password="..1qaz2wsx3edC"
)
app = faust.App(
    'ably-craft',
    broker='pkc-e8mp5.eu-west-1.aws.confluent.cloud:9092',
    topic_partitions=6,
    topic_replication_factor=3,
    store="memory://",
    broker_credentials=faust.SASLCredentials(
        ssl_context=context,
        mechanism='PLAIN',
        username="X4EUEKGZKGHPVNY2",
        password='9JxMaLvrGRwVUT7Bhf7P9/8ZlXd17f7Xjb3bx0XPKKtyoQSFkaDJwA0K+etpHNJl',
    )
)


class NumpyArrayEncoder(JSONEncoder):
    def default(self, obj):
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return JSONEncoder.default(self, obj)


presence_topic = app.topic('block-presence', value_type=str)
blocks_topic = app.topic('block-updates', value_type=ably_env)
chunk_table = app.GlobalTable("chunk-table")
chunky_table = app.GlobalTable("chunky-table")
chunky_dict = {}
channel_table = app.GlobalTable("channel-table")
channel_dict = {}


def getVoxelID(x: int, y: int, z: int) -> int:

    height = 3 * (sin(x / 20) + cos(z / 20))
    if y < height -3:
        return 1
    if y < height:
        return 2
    return 0  # signifying empty space


def make_array(offsets: List) -> np.array:
    my_array = np.full(32768, 0, dtype=np.uint8)
    iterations = 0
    print(offsets)
    for y in range(0, 32):
        for z in range(0, 32):
            for x in range(0, 32):
                my_array[iterations] = getVoxelID(x + (32 * offsets[0]), y + (32 * offsets[1]), z + (32 * offsets[2]))
                iterations += 1
                pass
            pass
        pass
    print(f'I have filled {iterations} cubes')
    return my_array


def make_sending_chunk(testData: np.array):
    encodedNumpyData = json.dumps(testData, cls=NumpyArrayEncoder)
    return encodedNumpyData


def make_offset_list(input: str) -> List[int]:
    my_list = []
    split_string = input.split('|')
    my_list.append(int(split_string[0]))
    my_list.append(int(split_string[1]))
    my_list.append(int(split_string[2]))
    return my_list


def find_offset():
    pass


@app.agent(presence_topic)
async def print_presence(presence_events):
    async for presence_change in presence_events:
        print(presence_change)
        if 'chunk' in presence_change:
            if presence_change['chunk'] in channel_dict.keys():
                pass
            else:
                offsets = make_offset_list(presence_change['chunk'][:-8])
                local_data = make_array(offsets).tolist()
                chunky_table[presence_change['chunk']] = {'offset': offsets,
                                                          'data': local_data}
                channel_dict[presence_change['chunk']] = client.channels.get('outbound:' + presence_change['chunk'])
                print('channel called: outbound:' + presence_change['chunk'])
                try:
                    await channel_dict[presence_change['chunk']].publish('update', local_data)
                except Exception:
                    print(presence_change)
                    print('oppsie')



@app.agent(blocks_topic)
async def update_chunks(block_events):
    async for block_event in block_events.take(50, within=1):
        publish_list = []

        for update in block_event:
            my_update = orjson.loads(update.messages[0].data)
            xpos = divmod(my_update['x'], 32)
            ypos = divmod(my_update['y'], 32)
            zpos = divmod(my_update['z'], 32)

            offset = (ypos[1] * 1024) + (zpos[1] * 32) + xpos[1]
            chunk_key = f'{xpos[0]}|{ypos[0]}|{zpos[0]}|default'
            publish_list.append(chunk_key)
            print(f'chunk key: {chunk_key}, offset: {offset}')  # = my_update['block']
            chunky_table[chunk_key]['data'][offset] = my_update['block']

            print(my_update)
            pass
        ably_coros = []
        for my_key in publish_list:
            ably_coros.append(channel_dict[my_key].publish('update', chunky_table[my_key]['data']))
            pass
        await asyncio.gather(*ably_coros)


class PresenceMessage(BaseModel):
    id: str
    clientid: str
    connectionid: str
    timestamp: datetime
    data: Optional[Union[dict, str]]
    action: int
    pass


# @app.timer(1)
# async def produce():
#     for k, v in channel_dict.items():
#         # await v.publish(name='update', data={'data': chunky_table[k]['data']})
#         # await v.publish(name='update', data=k)
#         print(f'my channel: {v.name}  + {k}')
#         pass
#     pass


if __name__ == '__main__':
    app.main()
