"""Bounded open-access retrieval and location-preserving parsing. Not an agent.

Europe PMC XML is preferred; arXiv PDFs use text extraction. No OCR or table
reconstruction is claimed. Unavailable full text falls back explicitly to abstracts.
"""
from __future__ import annotations
import io
import re
import time
import xml.etree.ElementTree as ET
import httpx

MAX_TEXT = 60000
_ncbi_last = 0.0


def pace_ncbi():
    global _ncbi_last
    wait = 0.36 - (time.monotonic() - _ncbi_last)
    if wait > 0:
        time.sleep(wait)
    _ncbi_last = time.monotonic()



def normalize(text):
    return re.sub(r'\s+', ' ', text or '').strip()


def passages_from_blocks(paper, blocks):
    result, size = [], 0
    for text, location in blocks:
        text = normalize(text)
        while text and size < MAX_TEXT and len(result) < 90:
            end = min(len(text), 1300, MAX_TEXT - size)
            if end < len(text):
                split = text.rfind(' ', 0, end)
                if split > end // 2:
                    end = split
            part, text = text[:end].strip(), text[end:].strip()
            if not part:
                break
            size += len(part)
            result.append({'id': f"p{paper['number']}x{len(result)+1}", 'paperId': paper['id'],
                           'sourceNumber': paper['number'], 'text': part, 'location': location})
    return result


def parse_jats(paper, xml):
    if b'<!ENTITY' in xml.upper():
        raise ValueError('External entities are unsupported.')
    root = ET.fromstring(xml)
    body = root.find('.//body')
    if body is None:
        raise ValueError('No full-text body.')
    blocks = []
    def walk(node, section='Body'):
        if node.tag == 'sec':
            title = node.find('title')
            if title is not None:
                section = normalize(' '.join(title.itertext())) or section
        if node.tag in ('p', 'table-wrap'):
            # Table text is retained in XML order; this is not table reconstruction.
            text = ' '.join(node.itertext())
            if len(normalize(text)) >= 20:
                blocks.append((text, {'kind': 'section', 'section': section,
                                     'elementId': node.get('id'), 'element': node.tag}))
            return
        for child in node:
            walk(child, section)
    walk(body)
    return passages_from_blocks(paper, blocks)


def download(url, maximum, client):
    if url.startswith('https://eutils.ncbi.nlm.nih.gov/'):
        pace_ncbi()
    with client.stream('GET', url) as response:
        response.raise_for_status()
        data = bytearray()
        for chunk in response.iter_bytes():
            data.extend(chunk)
            if len(data) > maximum:
                raise ValueError('Document exceeds size limit.')
    return bytes(data)


def retrieve_document(paper):
    pid = paper['id']
    try:
        with httpx.Client(timeout=18, follow_redirects=False,
                          headers={'User-Agent': 'Paperazzi/1.0 (literature review)'}) as client:
            if pid.startswith('arxiv:'):
                aid = pid[6:]
                if not re.fullmatch(r'(?:\d{4}\.\d{4,5}|[A-Za-z-]+/\d{7})(?:v\d+)?', aid):
                    raise ValueError('Invalid arXiv identifier.')
                from pypdf import PdfReader
                url = 'https://arxiv.org/pdf/' + aid
                data = download(url, 8000000, client)
                reader = PdfReader(io.BytesIO(data))
                blocks = [((page.extract_text() or ''), {'kind': 'page', 'page': index+1})
                          for index, page in enumerate(reader.pages[:35])]
                passages = passages_from_blocks(paper, blocks)
                mode = 'full_text_pdf'
            else:
                pmc = re.fullmatch(r'(?:PMC:)?(PMC\d+)', pid, re.I)
                pmid = re.fullmatch(r'(?:pubmed|MED):(\d+)', pid)
                pmcid = pmc.group(1).upper() if pmc else ''
                if pmid:
                    pace_ncbi()
                    r = client.get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/elink.fcgi',
                        params={'dbfrom':'pubmed','db':'pmc','linkname':'pubmed_pmc',
                                'id':pmid.group(1),'retmode':'json'})
                    r.raise_for_status()
                    links = [str(uid) for linkset in r.json().get('linksets', [])
                             for group in linkset.get('linksetdbs', []) if group.get('dbto') == 'pmc'
                             for uid in group.get('links', [])]
                    pmcid = 'PMC' + links[0] if links and links[0].isdigit() else ''
                if not pmcid:
                    doi = paper.get('doi')
                    if pmid:
                        raise ValueError('No PMC full-text link.')
                    if not doi or not re.fullmatch(r'10\.\d{4,9}/[^\s"{}]{1,180}', doi):
                        raise ValueError('No supported full-text identifier.')
                    r = client.get('https://www.ebi.ac.uk/europepmc/webservices/rest/search',
                                   params={'query':f'DOI:"{doi}"','format':'json','pageSize':1})
                    r.raise_for_status()
                    items = r.json().get('resultList', {}).get('result', [])
                    pmcid = items[0].get('pmcid', '') if items else ''
                if not re.fullmatch(r'PMC\d+', pmcid):
                    raise ValueError('No open-access full text.')
                url = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id=' + pmcid[3:]
                try:
                    passages = parse_jats(paper, download(url, 5000000, client))
                except Exception:
                    url = f'https://www.ebi.ac.uk/europepmc/webservices/rest/{pmcid}/fullTextXML'
                    passages = parse_jats(paper, download(url, 5000000, client))
                mode = 'full_text_xml'
            if not passages:
                raise ValueError('No extractable passages.')
            return {**paper, 'evidencePassages': passages,
                    'document': {'mode':mode, 'url':url, 'passageCount':len(passages),
                                 'boundedExtraction':True,
                                 'note':'Bounded text extraction; figures, supplements, and some tables may be missing.'}}
    except Exception:
        passages = passages_from_blocks(paper, [(paper.get('abstract', ''),
                                                 {'kind':'abstract','section':'Abstract'})])
        return {**paper, 'evidencePassages':passages,
                'document': {'mode':'abstract_only','url':paper.get('url'),
                             'passageCount':len(passages),
                             'note':'Full text was unavailable, unsupported, or could not be parsed. Only the abstract was read.'}}
